-- =============================================================================
-- Fantasy points and draft leaderboards. Safe to re-run.
--
-- Every night a job (app/api/cron/sync-points) reads each event's points page,
-- matches the players to the draft pool and calls sync_player_points, which:
--   1. stores each player's season total (player_points),
--   2. snapshots each player's total for the day (player_points_daily),
--   3. snapshots every draft's standings for the day (draft_standings_daily),
-- so the leaderboard can show day-on-day movement. Days are India dates.
--
-- Only the job (service_role) writes. Members read their own draft's board
-- through draft_leaderboard.
--
-- Starting points: points a player already had when a draft began don't count
-- for that draft. draft_point_offsets holds them per draft and player, and every
-- score below is (season total - offset). set_draft_points_baseline fills it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.fantasy_sources (
  pool text PRIMARY KEY,
  url text NOT NULL,
  label text
);

CREATE TABLE IF NOT EXISTS public.player_points (
  player_id bigint PRIMARY KEY REFERENCES public.draft_pool_players(id) ON DELETE CASCADE,
  pool text NOT NULL,
  points numeric NOT NULL DEFAULT 0,
  matches integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.player_points_daily (
  player_id bigint NOT NULL REFERENCES public.draft_pool_players(id) ON DELETE CASCADE,
  day date NOT NULL,
  points numeric NOT NULL,
  PRIMARY KEY (player_id, day)
);

CREATE TABLE IF NOT EXISTS public.draft_standings_daily (
  draft_id uuid NOT NULL REFERENCES public.draft_rooms(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.draft_members(id) ON DELETE CASCADE,
  day date NOT NULL,
  points numeric NOT NULL,
  rank integer NOT NULL,
  PRIMARY KEY (draft_id, member_id, day)
);

CREATE TABLE IF NOT EXISTS public.draft_point_offsets (
  draft_id uuid NOT NULL REFERENCES public.draft_rooms(id) ON DELETE CASCADE,
  player_id bigint NOT NULL REFERENCES public.draft_pool_players(id) ON DELETE CASCADE,
  points numeric NOT NULL,
  PRIMARY KEY (draft_id, player_id)
);

CREATE TABLE IF NOT EXISTS public.points_sync_log (
  id bigserial PRIMARY KEY,
  pool text NOT NULL,
  day date NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  source_rows integer NOT NULL DEFAULT 0,
  matched integer NOT NULL DEFAULT 0,
  unmatched jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS player_points_pool_idx ON public.player_points (pool);
CREATE INDEX IF NOT EXISTS draft_standings_daily_day_idx ON public.draft_standings_daily (draft_id, day);

ALTER TABLE public.fantasy_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_points_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_standings_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.points_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_point_offsets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fantasy_sources_read ON public.fantasy_sources;
CREATE POLICY fantasy_sources_read ON public.fantasy_sources FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS player_points_read ON public.player_points;
CREATE POLICY player_points_read ON public.player_points FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS draft_standings_read ON public.draft_standings_daily;
CREATE POLICY draft_standings_read ON public.draft_standings_daily
  FOR SELECT TO authenticated USING (public._is_draft_member(draft_id));
DROP POLICY IF EXISTS draft_point_offsets_read ON public.draft_point_offsets;
CREATE POLICY draft_point_offsets_read ON public.draft_point_offsets
  FOR SELECT TO authenticated USING (public._is_draft_member(draft_id));

REVOKE ALL ON public.fantasy_sources, public.player_points, public.player_points_daily,
  public.draft_standings_daily, public.points_sync_log, public.draft_point_offsets FROM anon, authenticated;
GRANT SELECT ON public.draft_point_offsets TO authenticated;
GRANT SELECT ON public.fantasy_sources, public.player_points, public.draft_standings_daily TO authenticated;

INSERT INTO public.fantasy_sources (pool, url, label) VALUES
  ('ILT20_2026', 'https://statz.ai/cricket/statz-leaders/ilt20/performance-points', 'Statz performance points')
ON CONFLICT (pool) DO UPDATE SET url = EXCLUDED.url, label = EXCLUDED.label;

-- The India date a sync belongs to. The job runs at midnight IST; a run up to an
-- hour early (cron jitter) still counts for the new day.
CREATE OR REPLACE FUNCTION public._points_day()
RETURNS date
LANGUAGE sql
STABLE
AS $$
  SELECT ((now() AT TIME ZONE 'Asia/Kolkata') + interval '1 hour')::date;
$$;

-- Current points of every member of a draft, ranked (ties share a rank).
CREATE OR REPLACE FUNCTION public._draft_current_standings(p_draft_id uuid)
RETURNS TABLE (member_id uuid, points numeric, rank integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH totals AS (
    SELECT m.id AS member_id, COALESCE(SUM(COALESCE(pp.points, 0) - COALESCE(o.points, 0)), 0) AS points
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

-- Called by the nightly job with the matched players: [{player_id, points, matches}].
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
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be an array';
  END IF;

  -- season totals: players in the feed get its numbers; everyone else keeps theirs
  INSERT INTO public.player_points (player_id, pool, points, matches, updated_at)
  SELECT (r->>'player_id')::bigint, p_pool, (r->>'points')::numeric, COALESCE((r->>'matches')::int, 0), now()
  FROM jsonb_array_elements(p_rows) r
  JOIN public.draft_pool_players dp ON dp.id = (r->>'player_id')::bigint AND dp.pool = p_pool
  ON CONFLICT (player_id) DO UPDATE
  SET points = EXCLUDED.points, matches = EXCLUDED.matches, updated_at = now();
  GET DIAGNOSTICS v_matched = ROW_COUNT;

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

  RETURN jsonb_build_object('day', v_day, 'matched', v_matched, 'drafts', n_drafts);
END;
$$;
REVOKE ALL ON FUNCTION public.sync_player_points(text, jsonb, integer, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_player_points(text, jsonb, integer, jsonb) TO service_role;

-- Pool players for the job to match names against (service_role only).
CREATE OR REPLACE FUNCTION public.points_pool_players(p_pool text)
RETURNS TABLE (id bigint, team text, player_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, team, player_name FROM public.draft_pool_players WHERE pool = p_pool;
$$;
REVOKE ALL ON FUNCTION public.points_pool_players(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.points_pool_players(text) TO service_role;

-- The leaderboard of one draft, for its members: current points and rank, the
-- previous day's points and rank, and each team's players with their points.
CREATE OR REPLACE FUNCTION public.draft_leaderboard(p_draft_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest date;
  v_prev date;
  v_synced timestamptz;
  v_pool text;
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._is_draft_member(p_draft_id) THEN
    RAISE EXCEPTION 'You are not in this draft';
  END IF;

  SELECT pool INTO v_pool FROM public.draft_rooms WHERE id = p_draft_id;
  SELECT MAX(day) INTO v_latest FROM public.draft_standings_daily WHERE draft_id = p_draft_id;
  SELECT MAX(day) INTO v_prev FROM public.draft_standings_daily WHERE draft_id = p_draft_id AND day < v_latest;
  SELECT MAX(ran_at) INTO v_synced FROM public.points_sync_log WHERE pool = v_pool;

  SELECT jsonb_build_object(
    'synced_at', v_synced,
    'latest_day', v_latest,
    'previous_day', v_prev,
    'rows', COALESCE(jsonb_agg(row ORDER BY (row->>'rank')::int, row->>'username'), '[]'::jsonb)
  )
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'member_id', m.id,
      'username', m.username,
      'user_id', m.user_id,
      'order_pos', m.order_pos,
      'points', cs.points,
      'rank', cs.rank,
      'prev_points', prev.points,
      'prev_rank', prev.rank,
      'players', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'player_id', dp.id,
          'name', dp.player_name,
          'team', dp.team,
          'role', dp.role,
          'points', COALESCE(pp.points, 0) - COALESCE(o.points, 0),
          'matches', COALESCE(pp.matches, 0),
          'prev_points', ppd.points - COALESCE(o.points, 0)
        ) ORDER BY COALESCE(pp.points, 0) - COALESCE(o.points, 0) DESC, dp.player_name), '[]'::jsonb)
        FROM public.draft_picks pk
        JOIN public.draft_pool_players dp ON dp.id = pk.player_id
        LEFT JOIN public.player_points pp ON pp.player_id = dp.id
        LEFT JOIN public.draft_point_offsets o ON o.draft_id = p_draft_id AND o.player_id = dp.id
        LEFT JOIN public.player_points_daily ppd ON ppd.player_id = dp.id AND ppd.day = v_prev
        WHERE pk.member_id = m.id
      )
    ) AS row
    FROM public.draft_members m
    JOIN public._draft_current_standings(p_draft_id) cs ON cs.member_id = m.id
    LEFT JOIN public.draft_standings_daily prev
      ON prev.draft_id = p_draft_id AND prev.member_id = m.id AND prev.day = v_prev
    WHERE m.draft_id = p_draft_id
  ) t;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_leaderboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_leaderboard(uuid) TO authenticated;

-- Reset a draft to zero from now on: every player's current season total becomes
-- their starting points for this draft, and today's standings snapshot is redone
-- so tomorrow's day-on-day change is measured from zero. Service role only
-- (run with scripts/set-draft-baseline.cjs).
CREATE OR REPLACE FUNCTION public.set_draft_points_baseline(p_draft_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool text;
  n integer;
BEGIN
  SELECT pool INTO v_pool FROM public.draft_rooms WHERE id = p_draft_id;
  IF v_pool IS NULL THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;

  DELETE FROM public.draft_point_offsets WHERE draft_id = p_draft_id;
  INSERT INTO public.draft_point_offsets (draft_id, player_id, points)
  SELECT p_draft_id, pp.player_id, pp.points
  FROM public.player_points pp
  WHERE pp.pool = v_pool AND pp.points <> 0;
  GET DIAGNOSTICS n = ROW_COUNT;

  DELETE FROM public.draft_standings_daily WHERE draft_id = p_draft_id AND day = public._points_day();
  IF EXISTS (SELECT 1 FROM public.points_sync_log WHERE pool = v_pool AND day = public._points_day()) THEN
    INSERT INTO public.draft_standings_daily (draft_id, member_id, day, points, rank)
    SELECT p_draft_id, s.member_id, public._points_day(), s.points, s.rank FROM public._draft_current_standings(p_draft_id) s;
  END IF;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.set_draft_points_baseline(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_draft_points_baseline(uuid) TO service_role;
