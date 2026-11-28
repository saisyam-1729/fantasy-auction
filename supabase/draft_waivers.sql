-- =============================================================================
-- Free agency ("waivers") for finished drafts. Safe to re-run.
-- Run after draft_teams.sql.
--
-- Rules (defaults):
--   * A host switches waivers on for a draft; it only works once the draft is DONE.
--   * Each team keeps a private, ranked list of up to 3 claims: "drop my player X,
--     add undrafted player Y". Claims stay pending until processed.
--   * Claims are processed once a week, in the nightly sync on Monday (India date),
--     or at once when a host runs them. Lowest-ranked team (fewest points) goes first;
--     ties go to the team that drafted last. Each team gets at most ONE swap per run:
--     its first claim that is still valid. Others become LOST.
--   * The dropped player goes back into the pool for everyone.
--   * Points: what the dropped player earned for the team while held is banked and
--     stays in the team's score; the incoming player counts only from the swap on.
--     A dropped Captain / Vice-captain is cleared.
--   * Other teams see a claim only once it has WON (who swapped whom).
-- =============================================================================

ALTER TABLE public.draft_rooms ADD COLUMN IF NOT EXISTS waivers_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.draft_member_bonus ADD COLUMN IF NOT EXISTS banked numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.draft_waiver_claims (
  id bigserial PRIMARY KEY,
  draft_id uuid NOT NULL REFERENCES public.draft_rooms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.draft_members(id) ON DELETE CASCADE,
  add_player_id bigint NOT NULL REFERENCES public.draft_pool_players(id) ON DELETE CASCADE,
  drop_player_id bigint NOT NULL REFERENCES public.draft_pool_players(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'WON', 'LOST')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS draft_waiver_claims_draft_idx ON public.draft_waiver_claims (draft_id, status);

ALTER TABLE public.draft_waiver_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS draft_waiver_claims_read ON public.draft_waiver_claims;
CREATE POLICY draft_waiver_claims_read ON public.draft_waiver_claims
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.draft_members m WHERE m.id = member_id AND m.user_id = auth.uid())
    OR (status = 'WON' AND public._is_draft_member(draft_id))
  );
REVOKE ALL ON public.draft_waiver_claims FROM anon, authenticated;
GRANT SELECT ON public.draft_waiver_claims TO authenticated;

-- Standings: players held + captain bonus + points banked from dropped players.
CREATE OR REPLACE FUNCTION public._draft_current_standings(p_draft_id uuid)
RETURNS TABLE (member_id uuid, points numeric, rank integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH totals AS (
    SELECT m.id AS member_id,
           COALESCE(SUM(COALESCE(pp.points, 0) - COALESCE(o.points, 0)), 0)
             + COALESCE((SELECT b.points + b.banked FROM public.draft_member_bonus b WHERE b.member_id = m.id), 0) AS points
    FROM public.draft_members m
    LEFT JOIN public.draft_picks pk ON pk.member_id = m.id
    LEFT JOIN public.player_points pp ON pp.player_id = pk.player_id
    LEFT JOIN public.draft_point_offsets o ON o.draft_id = p_draft_id AND o.player_id = pk.player_id
    WHERE m.draft_id = p_draft_id
    GROUP BY m.id
  )
  SELECT member_id, points, (RANK() OVER (ORDER BY points DESC))::int FROM totals;
$$;
REVOKE ALL ON FUNCTION public._draft_current_standings(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.draft_set_waivers_enabled(p_draft_id uuid, p_on boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._draft_is_host(p_draft_id) THEN
    RAISE EXCEPTION 'Only the host can switch waivers on or off';
  END IF;
  UPDATE public.draft_rooms SET waivers_enabled = COALESCE(p_on, false), updated_at = now() WHERE id = p_draft_id;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_set_waivers_enabled(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_set_waivers_enabled(uuid, boolean) TO authenticated;

-- Replace my pending claims with this ranked list: p_adds[i] replaces p_drops[i].
CREATE OR REPLACE FUNCTION public.draft_set_waiver_claims(p_draft_id uuid, p_adds bigint[], p_drops bigint[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member uuid;
  v_pool text;
  v_on boolean;
  v_status text;
  n integer := COALESCE(array_length(p_adds, 1), 0);
  i integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT m.id, d.pool, d.waivers_enabled, d.status INTO v_member, v_pool, v_on, v_status
  FROM public.draft_members m JOIN public.draft_rooms d ON d.id = m.draft_id
  WHERE m.draft_id = p_draft_id AND m.user_id = auth.uid();
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'You are not in this draft';
  END IF;
  IF NOT v_on THEN
    RAISE EXCEPTION 'Waivers are not switched on for this draft';
  END IF;
  IF v_status <> 'DONE' THEN
    RAISE EXCEPTION 'Waivers open once the draft is finished';
  END IF;
  IF n <> COALESCE(array_length(p_drops, 1), 0) THEN
    RAISE EXCEPTION 'Each claim needs a player to add and a player to drop';
  END IF;
  IF n > 3 THEN
    RAISE EXCEPTION 'You can keep at most 3 claims';
  END IF;

  FOR i IN 1..n LOOP
    IF NOT EXISTS (SELECT 1 FROM public.draft_picks WHERE draft_id = p_draft_id AND member_id = v_member AND player_id = p_drops[i]) THEN
      RAISE EXCEPTION 'You can only drop one of your own players';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.draft_pool_players WHERE id = p_adds[i] AND pool = v_pool) THEN
      RAISE EXCEPTION 'That player is not in this pool';
    END IF;
    IF EXISTS (SELECT 1 FROM public.draft_picks WHERE draft_id = p_draft_id AND player_id = p_adds[i]) THEN
      RAISE EXCEPTION 'That player is already on a team';
    END IF;
  END LOOP;

  DELETE FROM public.draft_waiver_claims WHERE draft_id = p_draft_id AND member_id = v_member AND status = 'PENDING';
  INSERT INTO public.draft_waiver_claims (draft_id, member_id, add_player_id, drop_player_id, rank)
  SELECT p_draft_id, v_member, a, d, MIN(o)::int
  FROM unnest(p_adds, p_drops) WITH ORDINALITY AS t(a, d, o)
  GROUP BY a, d;
  UPDATE public.draft_rooms SET updated_at = now() WHERE id = p_draft_id;
  RETURN (SELECT COUNT(*)::int FROM public.draft_waiver_claims WHERE draft_id = p_draft_id AND member_id = v_member AND status = 'PENDING');
END;
$$;
REVOKE ALL ON FUNCTION public.draft_set_waiver_claims(uuid, bigint[], bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_set_waiver_claims(uuid, bigint[], bigint[]) TO authenticated;

-- Process every pending claim of a draft. Returns the number of swaps made.
CREATE OR REPLACE FUNCTION public._draft_process_waivers(p_draft_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t record;
  c record;
  swaps integer := 0;
  v_pick integer;
  pp_add numeric;
  pp_drop numeric;
  off_drop numeric;
  done boolean;
BEGIN
  -- lowest score first; ties: the team that drafted last
  FOR t IN
    SELECT s.member_id
    FROM public._draft_current_standings(p_draft_id) s
    JOIN public.draft_members m ON m.id = s.member_id
    WHERE EXISTS (SELECT 1 FROM public.draft_waiver_claims w WHERE w.member_id = s.member_id AND w.status = 'PENDING')
    ORDER BY s.points ASC, m.order_pos DESC NULLS LAST
  LOOP
    done := false;
    FOR c IN
      SELECT * FROM public.draft_waiver_claims
      WHERE draft_id = p_draft_id AND member_id = t.member_id AND status = 'PENDING'
      ORDER BY rank
    LOOP
      IF done THEN
        UPDATE public.draft_waiver_claims SET status = 'LOST', note = 'Another claim of yours won', processed_at = now() WHERE id = c.id;
        CONTINUE;
      END IF;
      SELECT pick_no INTO v_pick FROM public.draft_picks
      WHERE draft_id = p_draft_id AND member_id = t.member_id AND player_id = c.drop_player_id;
      IF v_pick IS NULL THEN
        UPDATE public.draft_waiver_claims SET status = 'LOST', note = 'The player to drop is no longer on your team', processed_at = now() WHERE id = c.id;
        CONTINUE;
      END IF;
      IF EXISTS (SELECT 1 FROM public.draft_picks WHERE draft_id = p_draft_id AND player_id = c.add_player_id) THEN
        UPDATE public.draft_waiver_claims SET status = 'LOST', note = 'That player was already taken', processed_at = now() WHERE id = c.id;
        CONTINUE;
      END IF;

      SELECT COALESCE((SELECT points FROM public.player_points WHERE player_id = c.add_player_id), 0) INTO pp_add;
      SELECT COALESCE((SELECT points FROM public.player_points WHERE player_id = c.drop_player_id), 0) INTO pp_drop;
      SELECT COALESCE((SELECT points FROM public.draft_point_offsets WHERE draft_id = p_draft_id AND player_id = c.drop_player_id), 0) INTO off_drop;

      -- what the dropped player earned for this team stays in its score
      INSERT INTO public.draft_member_bonus (member_id, draft_id, points, banked)
      VALUES (t.member_id, p_draft_id, 0, pp_drop - off_drop)
      ON CONFLICT (member_id) DO UPDATE SET banked = public.draft_member_bonus.banked + EXCLUDED.banked;
      -- both players now count from this moment for whoever holds them next
      INSERT INTO public.draft_point_offsets (draft_id, player_id, points)
      VALUES (p_draft_id, c.drop_player_id, pp_drop), (p_draft_id, c.add_player_id, pp_add)
      ON CONFLICT (draft_id, player_id) DO UPDATE SET points = EXCLUDED.points;

      UPDATE public.draft_picks SET player_id = c.add_player_id, picked_by = NULL WHERE draft_id = p_draft_id AND pick_no = v_pick;
      UPDATE public.draft_captains SET captain_id = NULL WHERE member_id = t.member_id AND captain_id = c.drop_player_id;
      UPDATE public.draft_captains SET vice_id = NULL WHERE member_id = t.member_id AND vice_id = c.drop_player_id;
      UPDATE public.draft_captains SET pending_captain_id = NULL WHERE member_id = t.member_id AND pending_captain_id = c.drop_player_id;
      UPDATE public.draft_captains SET pending_vice_id = NULL WHERE member_id = t.member_id AND pending_vice_id = c.drop_player_id;

      UPDATE public.draft_waiver_claims SET status = 'WON', processed_at = now() WHERE id = c.id;
      swaps := swaps + 1;
      done := true;
    END LOOP;
  END LOOP;
  IF swaps > 0 THEN
    UPDATE public.draft_rooms SET updated_at = now() WHERE id = p_draft_id;
  END IF;
  RETURN swaps;
END;
$$;
REVOKE ALL ON FUNCTION public._draft_process_waivers(uuid) FROM PUBLIC, anon, authenticated;

-- A host can run the waivers right away (otherwise they run on Monday's nightly update).
CREATE OR REPLACE FUNCTION public.draft_host_run_waivers(p_draft_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._draft_is_host(p_draft_id) THEN
    RAISE EXCEPTION 'Only the host can run the waivers';
  END IF;
  IF NOT (SELECT waivers_enabled FROM public.draft_rooms WHERE id = p_draft_id) THEN
    RAISE EXCEPTION 'Waivers are not switched on for this draft';
  END IF;
  RETURN public._draft_process_waivers(p_draft_id);
END;
$$;
REVOKE ALL ON FUNCTION public.draft_host_run_waivers(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_host_run_waivers(uuid) TO authenticated;

-- The nightly sync: as in draft_teams.sql, plus waivers on Mondays (India date).
CREATE OR REPLACE FUNCTION public.sync_player_points(
  p_pool text,
  p_rows jsonb,
  p_source_rows integer DEFAULT 0,
  p_unmatched jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := public._points_day();
  v_matched integer;
  d record;
  n_drafts integer := 0;
  n_swaps integer := 0;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be an array';
  END IF;

  -- Captain bonus for the points gained since the last sync (before totals change).
  WITH fresh AS (
    SELECT (r->>'player_id')::bigint AS pid, (r->>'points')::numeric AS pts
    FROM jsonb_array_elements(p_rows) r
  ),
  delta AS (
    SELECT f.pid, f.pts - COALESCE(pp.points, 0) AS d
    FROM fresh f LEFT JOIN public.player_points pp ON pp.player_id = f.pid
  ),
  gained AS (
    SELECT m.draft_id, c.member_id,
           COALESCE((SELECT dl.d FROM delta dl WHERE dl.pid = c.captain_id
                      AND EXISTS (SELECT 1 FROM public.draft_picks pk WHERE pk.member_id = c.member_id AND pk.player_id = c.captain_id)), 0) * 1.0
         + COALESCE((SELECT dl.d FROM delta dl WHERE dl.pid = c.vice_id
                      AND EXISTS (SELECT 1 FROM public.draft_picks pk WHERE pk.member_id = c.member_id AND pk.player_id = c.vice_id)), 0) * 0.5 AS bonus
    FROM public.draft_captains c
    JOIN public.draft_members m ON m.id = c.member_id
    JOIN public.draft_rooms r ON r.id = m.draft_id
    WHERE r.captains_enabled AND r.pool = p_pool AND r.status <> 'LOBBY'
  )
  INSERT INTO public.draft_member_bonus (member_id, draft_id, points)
  SELECT member_id, draft_id, bonus FROM gained WHERE bonus <> 0
  ON CONFLICT (member_id) DO UPDATE SET points = public.draft_member_bonus.points + EXCLUDED.points;

  -- season totals: players in the feed get its numbers; everyone else keeps theirs
  INSERT INTO public.player_points (player_id, pool, points, matches, updated_at)
  SELECT (r->>'player_id')::bigint, p_pool, (r->>'points')::numeric, COALESCE((r->>'matches')::int, 0), now()
  FROM jsonb_array_elements(p_rows) r
  JOIN public.draft_pool_players dp ON dp.id = (r->>'player_id')::bigint AND dp.pool = p_pool
  ON CONFLICT (player_id) DO UPDATE
  SET points = EXCLUDED.points, matches = EXCLUDED.matches, updated_at = now();
  GET DIAGNOSTICS v_matched = ROW_COUNT;

  -- A choice made before this update now becomes active, for the next one.
  UPDATE public.draft_captains c
  SET captain_id = c.pending_captain_id, vice_id = c.pending_vice_id,
      pending_captain_id = NULL, pending_vice_id = NULL
  WHERE c.pending_captain_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.draft_members m JOIN public.draft_rooms r ON r.id = m.draft_id
                WHERE m.id = c.member_id AND r.pool = p_pool);

  -- Weekly waivers, on Mondays, with the fresh points.
  IF EXTRACT(DOW FROM v_day) = 1 THEN
    FOR d IN SELECT id FROM public.draft_rooms WHERE pool = p_pool AND waivers_enabled AND status = 'DONE' LOOP
      n_swaps := n_swaps + public._draft_process_waivers(d.id);
    END LOOP;
  END IF;

  -- today's per-player snapshot
  INSERT INTO public.player_points_daily (player_id, day, points)
  SELECT player_id, v_day, points FROM public.player_points WHERE pool = p_pool
  ON CONFLICT (player_id, day) DO UPDATE SET points = EXCLUDED.points;

  -- today's standings for every started draft on this pool
  FOR d IN SELECT id FROM public.draft_rooms WHERE pool = p_pool AND status <> 'LOBBY' LOOP
    INSERT INTO public.draft_standings_daily (draft_id, member_id, day, points, rank)
    SELECT d.id, s.member_id, v_day, s.points, s.rank FROM public._draft_current_standings(d.id) s
    ON CONFLICT (draft_id, member_id, day) DO UPDATE SET points = EXCLUDED.points, rank = EXCLUDED.rank;
    n_drafts := n_drafts + 1;
  END LOOP;

  INSERT INTO public.points_sync_log (pool, day, source_rows, matched, unmatched)
  VALUES (p_pool, v_day, COALESCE(p_source_rows, 0), v_matched, COALESCE(p_unmatched, '[]'::jsonb));

  RETURN jsonb_build_object('day', v_day, 'matched', v_matched, 'drafts', n_drafts, 'waiver_swaps', n_swaps);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_player_points(text, jsonb, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_player_points(text, jsonb, integer, jsonb) TO service_role;
