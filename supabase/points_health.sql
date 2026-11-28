-- =============================================================================
-- Is the nightly points update healthy? Safe to re-run.
-- Run after fantasy_points.sql.
--
-- points_health() is callable without signing in (an uptime monitor or the GitHub
-- watchdog calls it through /api/health/points). It returns only counts and times,
-- never player or team names: per points source, when it last ran successfully, how
-- many hours ago, whether that is stale (over 30 h, so a night was missed), how
-- many rows the page had and how many names could not be matched.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.points_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (s.pool)
           s.pool, l.ran_at, l.source_rows, l.matched, jsonb_array_length(l.unmatched) AS unmatched_count
    FROM public.fantasy_sources s
    LEFT JOIN public.points_sync_log l ON l.pool = s.pool
    ORDER BY s.pool, l.ran_at DESC NULLS LAST
  ),
  checked AS (
    SELECT pool, ran_at, source_rows, matched, unmatched_count,
           CASE WHEN ran_at IS NULL THEN NULL ELSE round((EXTRACT(EPOCH FROM (now() - ran_at)) / 3600)::numeric, 1) END AS hours_ago,
           (ran_at IS NULL OR now() - ran_at > interval '30 hours') AS stale
    FROM latest
  )
  SELECT jsonb_build_object(
    'ok', COALESCE(bool_and(NOT stale), true),
    'checked_at', now(),
    'pools', COALESCE(jsonb_agg(jsonb_build_object(
      'pool', pool, 'ran_at', ran_at, 'hours_ago', hours_ago, 'stale', stale,
      'source_rows', source_rows, 'matched', matched, 'unmatched_count', unmatched_count
    ) ORDER BY pool), '[]'::jsonb)
  )
  FROM checked;
$$;
REVOKE ALL ON FUNCTION public.points_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.points_health() TO anon, authenticated, service_role;
