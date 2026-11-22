-- =============================================================================
-- Draft extras: wishlists and an optional pick timer. Safe to re-run.
-- Run after supabase/draft.sql.
--
-- Wishlist: each member keeps a private, ordered list of players they want.
-- Pick timer: a room may give each turn N seconds (pick_seconds). When a turn
-- runs out, any member's screen asks draft_auto_pick to pick for the team on the
-- clock: the top available player on their wishlist, else the available player
-- with the most fantasy points, else the first available player in the pool.
-- The database checks the time, so no screen can pick early.
-- =============================================================================

ALTER TABLE public.draft_rooms ADD COLUMN IF NOT EXISTS pick_seconds integer;
ALTER TABLE public.draft_rooms ADD COLUMN IF NOT EXISTS turn_started_at timestamptz;
ALTER TABLE public.draft_rooms DROP CONSTRAINT IF EXISTS draft_rooms_pick_seconds_check;
ALTER TABLE public.draft_rooms ADD CONSTRAINT draft_rooms_pick_seconds_check CHECK (pick_seconds IS NULL OR pick_seconds BETWEEN 15 AND 600);

-- The clock restarts when the draft starts and after every pick or undo.
CREATE OR REPLACE FUNCTION public._draft_turn_on_start()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'DRAFTING' AND OLD.status IS DISTINCT FROM 'DRAFTING' THEN
    NEW.turn_started_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS draft_turn_on_start ON public.draft_rooms;
CREATE TRIGGER draft_turn_on_start BEFORE UPDATE ON public.draft_rooms
  FOR EACH ROW EXECUTE FUNCTION public._draft_turn_on_start();

CREATE OR REPLACE FUNCTION public._draft_turn_on_pick()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.draft_rooms SET turn_started_at = now() WHERE id = COALESCE(NEW.draft_id, OLD.draft_id);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS draft_turn_on_pick ON public.draft_picks;
CREATE TRIGGER draft_turn_on_pick AFTER INSERT OR DELETE ON public.draft_picks
  FOR EACH ROW EXECUTE FUNCTION public._draft_turn_on_pick();

-- create_draft_room with an optional pick timer (replaces the 4-argument version).
DROP FUNCTION IF EXISTS public.create_draft_room(text, integer, integer, text);
CREATE OR REPLACE FUNCTION public.create_draft_room(
  p_name text,
  p_picks_per_team integer DEFAULT 15,
  p_max_members integer DEFAULT 10,
  p_pool text DEFAULT 'SMAT_2026',
  p_pick_seconds integer DEFAULT NULL
)
RETURNS TABLE (id uuid, room_code text, room_key text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_code text;
  v_key text;
  tries integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_name IS NULL OR p_name !~ '^[A-Za-z0-9]{3,30}$' THEN
    RAISE EXCEPTION 'Room name must be 3 to 30 letters or digits';
  END IF;
  IF p_picks_per_team IS NULL OR p_picks_per_team NOT BETWEEN 1 AND 30 THEN
    RAISE EXCEPTION 'Picks per team must be from 1 to 30';
  END IF;
  IF p_max_members IS NULL OR p_max_members NOT BETWEEN 3 AND 10 THEN
    RAISE EXCEPTION 'A draft needs room for 3 to 10 teams';
  END IF;
  IF p_pick_seconds IS NOT NULL AND p_pick_seconds NOT BETWEEN 15 AND 600 THEN
    RAISE EXCEPTION 'The pick timer must be from 15 to 600 seconds';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.draft_pool_players WHERE pool = p_pool) THEN
    RAISE EXCEPTION 'Unknown player pool %', p_pool;
  END IF;

  v_key := lpad((floor(random() * 1000000))::int::text, 6, '0');
  LOOP
    tries := tries + 1;
    v_code := p_name || '_' || (floor(random() * 999) + 1)::int;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.draft_rooms d WHERE d.room_code = v_code);
    IF tries > 20 THEN
      RAISE EXCEPTION 'Could not find a free room code. Try another name.';
    END IF;
  END LOOP;

  INSERT INTO public.draft_rooms (room_code, room_key, name, pool, owner_id, picks_per_team, max_members, pick_seconds)
  VALUES (v_code, v_key, p_name, p_pool, auth.uid(), p_picks_per_team, p_max_members, p_pick_seconds)
  RETURNING draft_rooms.id INTO v_id;

  INSERT INTO public.draft_members (draft_id, user_id, username, is_host)
  VALUES (v_id, auth.uid(), public._draft_username(), true);

  RETURN QUERY SELECT v_id, v_code, v_key;
END;
$$;
REVOKE ALL ON FUNCTION public.create_draft_room(text, integer, integer, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_room(text, integer, integer, text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- Wishlists (private to each member)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.draft_wishlist (
  member_id uuid NOT NULL REFERENCES public.draft_members(id) ON DELETE CASCADE,
  player_id bigint NOT NULL REFERENCES public.draft_pool_players(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  PRIMARY KEY (member_id, player_id)
);
ALTER TABLE public.draft_wishlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS draft_wishlist_own ON public.draft_wishlist;
CREATE POLICY draft_wishlist_own ON public.draft_wishlist
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.draft_members m WHERE m.id = member_id AND m.user_id = auth.uid()));
REVOKE ALL ON public.draft_wishlist FROM anon, authenticated;
GRANT SELECT ON public.draft_wishlist TO authenticated;

-- Replace the caller's wishlist for a draft with these players, in this order.
CREATE OR REPLACE FUNCTION public.draft_set_wishlist(p_draft_id uuid, p_player_ids bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member uuid;
  v_pool text;
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT m.id, d.pool INTO v_member, v_pool
  FROM public.draft_members m JOIN public.draft_rooms d ON d.id = m.draft_id
  WHERE m.draft_id = p_draft_id AND m.user_id = auth.uid();
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'You are not in this draft';
  END IF;
  IF COALESCE(array_length(p_player_ids, 1), 0) > 200 THEN
    RAISE EXCEPTION 'A wishlist can hold at most 200 players';
  END IF;

  DELETE FROM public.draft_wishlist WHERE member_id = v_member;
  INSERT INTO public.draft_wishlist (member_id, player_id, rank)
  SELECT v_member, x.pid, MIN(x.ord)::int
  FROM unnest(COALESCE(p_player_ids, '{}')) WITH ORDINALITY AS x(pid, ord)
  JOIN public.draft_pool_players dp ON dp.id = x.pid AND dp.pool = v_pool
  GROUP BY x.pid;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_set_wishlist(uuid, bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_set_wishlist(uuid, bigint[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- Auto-pick when a timed turn runs out
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.draft_auto_pick(p_draft_id uuid, p_pick_no integer)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.draft_rooms%ROWTYPE;
  n_members integer;
  pick_no integer;
  on_clock public.draft_members%ROWTYPE;
  v_player bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT * INTO d FROM public.draft_rooms WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND OR NOT public._is_draft_member(p_draft_id) THEN
    RAISE EXCEPTION 'You are not in this draft';
  END IF;
  -- not a timed draft, not running, or someone already picked: nothing to do
  IF d.status <> 'DRAFTING' OR d.pick_seconds IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT COUNT(*) INTO pick_no FROM public.draft_picks WHERE draft_id = p_draft_id;
  IF p_pick_no IS DISTINCT FROM pick_no THEN
    RETURN NULL;
  END IF;
  IF now() < d.turn_started_at + make_interval(secs => d.pick_seconds) THEN
    RAISE EXCEPTION 'This turn has not run out yet';
  END IF;

  SELECT COUNT(*) INTO n_members FROM public.draft_members WHERE draft_id = p_draft_id;
  SELECT * INTO on_clock FROM public.draft_members
  WHERE draft_id = p_draft_id AND order_pos = public._draft_slot(pick_no, n_members);

  SELECT w.player_id INTO v_player
  FROM public.draft_wishlist w
  WHERE w.member_id = on_clock.id
    AND NOT EXISTS (SELECT 1 FROM public.draft_picks p WHERE p.draft_id = p_draft_id AND p.player_id = w.player_id)
  ORDER BY w.rank
  LIMIT 1;

  IF v_player IS NULL THEN
    SELECT dp.id INTO v_player
    FROM public.draft_pool_players dp
    LEFT JOIN public.player_points pp ON pp.player_id = dp.id
    LEFT JOIN public.draft_point_offsets o ON o.draft_id = p_draft_id AND o.player_id = dp.id
    WHERE dp.pool = d.pool
      AND NOT EXISTS (SELECT 1 FROM public.draft_picks p WHERE p.draft_id = p_draft_id AND p.player_id = dp.id)
    ORDER BY COALESCE(pp.points, 0) - COALESCE(o.points, 0) DESC, dp.sort_no
    LIMIT 1;
  END IF;
  IF v_player IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.draft_picks (draft_id, pick_no, member_id, player_id, picked_by)
  VALUES (p_draft_id, pick_no, on_clock.id, v_player, NULL);
  UPDATE public.draft_rooms
  SET status = CASE WHEN pick_no + 1 >= n_members * d.picks_per_team THEN 'DONE' ELSE 'DRAFTING' END,
      updated_at = now()
  WHERE id = p_draft_id;
  RETURN v_player;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_auto_pick(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_auto_pick(uuid, integer) TO authenticated;

-- Current fantasy points of a draft's pool (after the draft's starting points),
-- for showing next to players in the pool. Members only.
CREATE OR REPLACE FUNCTION public.draft_pool_points(p_draft_id uuid)
RETURNS TABLE (player_id bigint, points numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pp.player_id, pp.points - COALESCE(o.points, 0)
  FROM public.draft_rooms d
  JOIN public.player_points pp ON pp.pool = d.pool
  LEFT JOIN public.draft_point_offsets o ON o.draft_id = d.id AND o.player_id = pp.player_id
  WHERE d.id = p_draft_id AND public._is_draft_member(p_draft_id);
$$;
REVOKE ALL ON FUNCTION public.draft_pool_points(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_pool_points(uuid) TO authenticated;
