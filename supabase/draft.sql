-- =============================================================================
-- Draft rooms (SMAT 2026 and later pools). Safe to re-run.
--
-- A draft is not an auction: everyone sees one pool and teams take turns picking.
--   1. Members join with a room code + key (3 to 10 members).
--   2. The host spins a wheel. Each spin gives the next draft position to a random
--      member who has none yet; when one member is left they take the last position.
--   3. Snake order: with 5 teams the picks go 1,2,3,4,5, 5,4,3,2,1, 1,2,3,...
--   4. Only the member on the clock may pick (the host may pick for them).
--   5. The draft ends after picks_per_team rounds.
--
-- Tables are read by members only (RLS). Every change goes through the
-- SECURITY DEFINER functions below, which check the caller.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.draft_pool_players (
  id bigserial PRIMARY KEY,
  pool text NOT NULL,
  sort_no integer NOT NULL DEFAULT 0,
  team text NOT NULL,
  player_name text NOT NULL,
  role text,
  captain text,
  notes text,
  UNIQUE (pool, team, player_name)
);

CREATE TABLE IF NOT EXISTS public.draft_rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code text NOT NULL UNIQUE,
  room_key text NOT NULL,
  name text NOT NULL,
  pool text NOT NULL DEFAULT 'SMAT_2026',
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'LOBBY' CHECK (status IN ('LOBBY', 'DRAFTING', 'DONE')),
  picks_per_team integer NOT NULL DEFAULT 15 CHECK (picks_per_team BETWEEN 1 AND 30),
  max_members integer NOT NULL DEFAULT 10 CHECK (max_members BETWEEN 3 AND 10),
  -- the last wheel spin, so every screen can animate it: {seq, member_id, position, last_member_id};
  -- after a reset only {seq} is kept
  last_spin jsonb,
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.draft_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.draft_rooms(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL,
  is_host boolean NOT NULL DEFAULT false,
  order_pos integer,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, user_id),
  UNIQUE (draft_id, order_pos)
);

CREATE TABLE IF NOT EXISTS public.draft_picks (
  id bigserial PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES public.draft_rooms(id) ON DELETE CASCADE,
  pick_no integer NOT NULL,
  member_id uuid NOT NULL REFERENCES public.draft_members(id) ON DELETE CASCADE,
  player_id bigint NOT NULL REFERENCES public.draft_pool_players(id),
  picked_by uuid,
  picked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, pick_no),
  UNIQUE (draft_id, player_id)
);

CREATE INDEX IF NOT EXISTS draft_members_user_idx ON public.draft_members (user_id);
CREATE INDEX IF NOT EXISTS draft_picks_member_idx ON public.draft_picks (member_id);
CREATE INDEX IF NOT EXISTS draft_pool_players_pool_idx ON public.draft_pool_players (pool, sort_no);

-- ---------------------------------------------------------------------------
-- Row level security: read-only for members, no direct writes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_draft_member(p_draft_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.draft_members m
    WHERE m.draft_id = p_draft_id AND m.user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public._is_draft_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._is_draft_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._draft_is_host(p_draft_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.draft_members m
    WHERE m.draft_id = p_draft_id AND m.user_id = auth.uid() AND m.is_host
  );
$$;
REVOKE ALL ON FUNCTION public._draft_is_host(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._draft_is_host(uuid) TO authenticated;

ALTER TABLE public.draft_pool_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS draft_pool_read ON public.draft_pool_players;
CREATE POLICY draft_pool_read ON public.draft_pool_players
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS draft_rooms_read ON public.draft_rooms;
CREATE POLICY draft_rooms_read ON public.draft_rooms
  FOR SELECT TO authenticated USING (public._is_draft_member(id));

DROP POLICY IF EXISTS draft_members_read ON public.draft_members;
CREATE POLICY draft_members_read ON public.draft_members
  FOR SELECT TO authenticated USING (public._is_draft_member(draft_id));

DROP POLICY IF EXISTS draft_picks_read ON public.draft_picks;
CREATE POLICY draft_picks_read ON public.draft_picks
  FOR SELECT TO authenticated USING (public._is_draft_member(draft_id));

REVOKE INSERT, UPDATE, DELETE ON public.draft_pool_players, public.draft_rooms, public.draft_members, public.draft_picks FROM anon, authenticated;
GRANT SELECT ON public.draft_pool_players, public.draft_rooms, public.draft_members, public.draft_picks TO authenticated;

-- Live updates for the draft screen.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['draft_rooms', 'draft_members', 'draft_picks'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Snake order: draft position (1..n) that makes pick number p (0-based).
CREATE OR REPLACE FUNCTION public._draft_slot(p_pick_no integer, p_n integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN (p_pick_no / p_n) % 2 = 0
              THEN (p_pick_no % p_n) + 1
              ELSE p_n - (p_pick_no % p_n) END;
$$;

CREATE OR REPLACE FUNCTION public._draft_username()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1), 'user')
  FROM auth.users u WHERE u.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public._draft_username() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Create, join, list
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_draft_room(
  p_name text,
  p_picks_per_team integer DEFAULT 15,
  p_max_members integer DEFAULT 10,
  p_pool text DEFAULT 'SMAT_2026'
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

  INSERT INTO public.draft_rooms (room_code, room_key, name, pool, owner_id, picks_per_team, max_members)
  VALUES (v_code, v_key, p_name, p_pool, auth.uid(), p_picks_per_team, p_max_members)
  RETURNING draft_rooms.id INTO v_id;

  INSERT INTO public.draft_members (draft_id, user_id, username, is_host)
  VALUES (v_id, auth.uid(), public._draft_username(), true);

  RETURN QUERY SELECT v_id, v_code, v_key;
END;
$$;
REVOKE ALL ON FUNCTION public.create_draft_room(text, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_draft_room(text, integer, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.join_draft_room(p_room_code text, p_room_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.draft_rooms%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO d FROM public.draft_rooms
  WHERE room_code = trim(p_room_code) AND room_key = trim(p_room_key)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid Room ID or Room Key';
  END IF;

  IF EXISTS (SELECT 1 FROM public.draft_members WHERE draft_id = d.id AND user_id = auth.uid()) THEN
    RETURN d.id;
  END IF;
  IF d.status <> 'LOBBY' THEN
    RAISE EXCEPTION 'This draft has already started';
  END IF;
  IF (SELECT COUNT(*) FROM public.draft_members WHERE draft_id = d.id) >= d.max_members THEN
    RAISE EXCEPTION 'Room is full (max % teams)', d.max_members;
  END IF;

  INSERT INTO public.draft_members (draft_id, user_id, username, is_host)
  VALUES (d.id, auth.uid(), public._draft_username(), false);
  UPDATE public.draft_rooms SET updated_at = now() WHERE id = d.id;
  RETURN d.id;
END;
$$;
REVOKE ALL ON FUNCTION public.join_draft_room(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_draft_room(text, text) TO authenticated;

-- Open draft lobbies (no keys).
CREATE OR REPLACE FUNCTION public.list_open_draft_rooms()
RETURNS TABLE (id uuid, room_code text, name text, pool text, member_count integer, max_members integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, d.room_code, d.name, d.pool,
         (SELECT COUNT(*)::int FROM public.draft_members m WHERE m.draft_id = d.id),
         d.max_members
  FROM public.draft_rooms d
  WHERE d.status = 'LOBBY'
    AND (SELECT COUNT(*) FROM public.draft_members m WHERE m.draft_id = d.id) < d.max_members
  ORDER BY d.created_at DESC
  LIMIT 50;
$$;
REVOKE ALL ON FUNCTION public.list_open_draft_rooms() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_open_draft_rooms() TO authenticated;

-- ---------------------------------------------------------------------------
-- Lobby: remove a member, spin the wheel, reset the order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.draft_remove_member(p_draft_id uuid, p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.draft_rooms%ROWTYPE;
  target public.draft_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT * INTO d FROM public.draft_rooms WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;
  SELECT * INTO target FROM public.draft_members WHERE id = p_member_id AND draft_id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That player is not in this draft';
  END IF;
  -- a member may leave; a host may remove someone
  IF target.user_id <> auth.uid() AND NOT public._draft_is_host(p_draft_id) THEN
    RAISE EXCEPTION 'Only the host can remove a player';
  END IF;
  IF target.user_id = d.owner_id THEN
    RAISE EXCEPTION 'The host cannot leave their own draft. Delete it instead.';
  END IF;
  IF d.status <> 'LOBBY' THEN
    RAISE EXCEPTION 'Players cannot leave once the draft has started';
  END IF;

  DELETE FROM public.draft_members WHERE id = p_member_id;
  -- the order no longer fits, so the wheel starts again
  UPDATE public.draft_members SET order_pos = NULL WHERE draft_id = p_draft_id;
  -- keep the spin counter so every screen animates the next spin
  UPDATE public.draft_rooms
  SET last_spin = CASE WHEN last_spin IS NULL THEN NULL ELSE jsonb_build_object('seq', last_spin->'seq') END,
      updated_at = now()
  WHERE id = p_draft_id;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_remove_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_remove_member(uuid, uuid) TO authenticated;

-- One spin: a random member without a position gets the next one. When only one
-- member is left after that, they take the last position automatically.
CREATE OR REPLACE FUNCTION public.draft_spin_wheel(p_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.draft_rooms%ROWTYPE;
  n_members integer;
  next_pos integer;
  chosen uuid;
  last_one uuid;
  seq integer;
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._draft_is_host(p_draft_id) THEN
    RAISE EXCEPTION 'Only the host can spin the wheel';
  END IF;
  SELECT * INTO d FROM public.draft_rooms WHERE id = p_draft_id FOR UPDATE;
  IF d.status <> 'LOBBY' THEN
    RAISE EXCEPTION 'The draft order is already fixed';
  END IF;

  SELECT COUNT(*) INTO n_members FROM public.draft_members WHERE draft_id = p_draft_id;
  IF n_members < 3 THEN
    RAISE EXCEPTION 'A draft needs at least 3 players';
  END IF;

  SELECT id INTO chosen FROM public.draft_members
  WHERE draft_id = p_draft_id AND order_pos IS NULL
  ORDER BY random() LIMIT 1;
  IF chosen IS NULL THEN
    RAISE EXCEPTION 'Everyone already has a draft position';
  END IF;

  SELECT COALESCE(MAX(order_pos), 0) + 1 INTO next_pos FROM public.draft_members WHERE draft_id = p_draft_id;
  UPDATE public.draft_members SET order_pos = next_pos WHERE id = chosen;

  SELECT id INTO last_one FROM public.draft_members WHERE draft_id = p_draft_id AND order_pos IS NULL;
  IF last_one IS NOT NULL AND (SELECT COUNT(*) FROM public.draft_members WHERE draft_id = p_draft_id AND order_pos IS NULL) = 1 THEN
    UPDATE public.draft_members SET order_pos = next_pos + 1 WHERE id = last_one;
  ELSE
    last_one := NULL;
  END IF;

  seq := COALESCE((d.last_spin->>'seq')::int, 0) + 1;
  result := jsonb_build_object('seq', seq, 'member_id', chosen, 'position', next_pos, 'last_member_id', last_one);
  UPDATE public.draft_rooms SET last_spin = result, updated_at = now() WHERE id = p_draft_id;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_spin_wheel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_spin_wheel(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.draft_reset_order(p_draft_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._draft_is_host(p_draft_id) THEN
    RAISE EXCEPTION 'Only the host can reset the order';
  END IF;
  SELECT status INTO v_status FROM public.draft_rooms WHERE id = p_draft_id FOR UPDATE;
  IF v_status <> 'LOBBY' THEN
    RAISE EXCEPTION 'The draft has already started';
  END IF;
  UPDATE public.draft_members SET order_pos = NULL WHERE draft_id = p_draft_id;
  -- keep the spin counter so every screen animates the next spin
  UPDATE public.draft_rooms
  SET last_spin = CASE WHEN last_spin IS NULL THEN NULL ELSE jsonb_build_object('seq', last_spin->'seq') END,
      updated_at = now()
  WHERE id = p_draft_id;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_reset_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_reset_order(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Start, pick, undo, delete
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.draft_start(p_draft_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.draft_rooms%ROWTYPE;
  n_members integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._draft_is_host(p_draft_id) THEN
    RAISE EXCEPTION 'Only the host can start the draft';
  END IF;
  SELECT * INTO d FROM public.draft_rooms WHERE id = p_draft_id FOR UPDATE;
  IF d.status <> 'LOBBY' THEN
    RAISE EXCEPTION 'The draft has already started';
  END IF;
  SELECT COUNT(*) INTO n_members FROM public.draft_members WHERE draft_id = p_draft_id;
  IF n_members < 3 OR n_members > 10 THEN
    RAISE EXCEPTION 'A draft needs 3 to 10 players (now %)', n_members;
  END IF;
  IF EXISTS (SELECT 1 FROM public.draft_members WHERE draft_id = p_draft_id AND order_pos IS NULL) THEN
    RAISE EXCEPTION 'Spin the wheel until everyone has a draft position';
  END IF;
  IF n_members * d.picks_per_team > (SELECT COUNT(*) FROM public.draft_pool_players WHERE pool = d.pool) THEN
    RAISE EXCEPTION 'Not enough players in the pool for % picks each', d.picks_per_team;
  END IF;

  UPDATE public.draft_rooms SET status = 'DRAFTING', started_at = now(), updated_at = now() WHERE id = p_draft_id;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_start(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_start(uuid) TO authenticated;

-- Pick a player for the team on the clock. p_pick_no is the pick the caller's
-- screen showed; if someone else picked first the call is rejected instead of
-- landing on the next team's turn.
CREATE OR REPLACE FUNCTION public.draft_make_pick(p_draft_id uuid, p_player_id bigint, p_pick_no integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.draft_rooms%ROWTYPE;
  n_members integer;
  pick_no integer;
  on_clock public.draft_members%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT * INTO d FROM public.draft_rooms WHERE id = p_draft_id FOR UPDATE;
  IF NOT FOUND OR NOT public._is_draft_member(p_draft_id) THEN
    RAISE EXCEPTION 'You are not in this draft';
  END IF;
  IF d.status = 'LOBBY' THEN
    RAISE EXCEPTION 'The draft has not started';
  END IF;
  IF d.status = 'DONE' THEN
    RAISE EXCEPTION 'The draft is over';
  END IF;

  SELECT COUNT(*) INTO n_members FROM public.draft_members WHERE draft_id = p_draft_id;
  SELECT COUNT(*) INTO pick_no FROM public.draft_picks WHERE draft_id = p_draft_id;
  IF p_pick_no IS DISTINCT FROM pick_no THEN
    RAISE EXCEPTION 'That turn has already been taken. Refreshing.';
  END IF;

  SELECT * INTO on_clock FROM public.draft_members
  WHERE draft_id = p_draft_id AND order_pos = public._draft_slot(pick_no, n_members);
  IF on_clock.user_id <> auth.uid() AND NOT public._draft_is_host(p_draft_id) THEN
    RAISE EXCEPTION 'It is not your turn';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.draft_pool_players WHERE id = p_player_id AND pool = d.pool) THEN
    RAISE EXCEPTION 'That player is not in this pool';
  END IF;
  IF EXISTS (SELECT 1 FROM public.draft_picks WHERE draft_id = p_draft_id AND player_id = p_player_id) THEN
    RAISE EXCEPTION 'That player has already been picked';
  END IF;

  INSERT INTO public.draft_picks (draft_id, pick_no, member_id, player_id, picked_by)
  VALUES (p_draft_id, pick_no, on_clock.id, p_player_id, auth.uid());

  UPDATE public.draft_rooms
  SET status = CASE WHEN pick_no + 1 >= n_members * d.picks_per_team THEN 'DONE' ELSE 'DRAFTING' END,
      updated_at = now()
  WHERE id = p_draft_id;
  RETURN pick_no;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_make_pick(uuid, bigint, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_make_pick(uuid, bigint, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.draft_undo_pick(p_draft_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.draft_rooms%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._draft_is_host(p_draft_id) THEN
    RAISE EXCEPTION 'Only the host can undo a pick';
  END IF;
  SELECT * INTO d FROM public.draft_rooms WHERE id = p_draft_id FOR UPDATE;
  IF d.status = 'LOBBY' THEN
    RAISE EXCEPTION 'The draft has not started';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.draft_picks WHERE draft_id = p_draft_id) THEN
    RAISE EXCEPTION 'There is no pick to undo';
  END IF;
  DELETE FROM public.draft_picks
  WHERE draft_id = p_draft_id
    AND pick_no = (SELECT MAX(pick_no) FROM public.draft_picks WHERE draft_id = p_draft_id);
  UPDATE public.draft_rooms SET status = 'DRAFTING', updated_at = now() WHERE id = p_draft_id;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_undo_pick(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_undo_pick(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.draft_delete_room(p_draft_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.draft_rooms WHERE id = p_draft_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the host who created the draft can delete it';
  END IF;
  DELETE FROM public.draft_rooms WHERE id = p_draft_id;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_delete_room(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_delete_room(uuid) TO authenticated;
