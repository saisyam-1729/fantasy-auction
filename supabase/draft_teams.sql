-- =============================================================================
-- Team identity and captains for drafts. Safe to re-run.
-- Run after fantasy_points.sql, draft_extras.sql and draft_admin.sql.
--
-- Team identity: each member can give their draft team a name, an emoji and a colour.
--
-- Captains: a host may switch captains on for a draft. Each team then picks a
-- Captain (2x points) and an optional Vice-captain (1.5x) from its own players.
-- The bonus is the extra 1x / 0.5x of the points those players earn AFTER the
-- choice takes effect, added to the team's score:
--   * the nightly sync adds the bonus for the points gained since the last sync,
--   * a new choice is "pending" and becomes active only after the next sync, so
--     nobody can switch to a player who already scored in a match not yet synced.
-- Switching captains on mid-draft applies from then on, never backwards.
-- =============================================================================

ALTER TABLE public.draft_members ADD COLUMN IF NOT EXISTS team_name text;
ALTER TABLE public.draft_members ADD COLUMN IF NOT EXISTS team_emoji text;
ALTER TABLE public.draft_members ADD COLUMN IF NOT EXISTS team_color text;
ALTER TABLE public.draft_rooms ADD COLUMN IF NOT EXISTS captains_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.draft_captains (
  member_id uuid PRIMARY KEY REFERENCES public.draft_members(id) ON DELETE CASCADE,
  captain_id bigint REFERENCES public.draft_pool_players(id) ON DELETE SET NULL,
  vice_id bigint REFERENCES public.draft_pool_players(id) ON DELETE SET NULL,
  pending_captain_id bigint REFERENCES public.draft_pool_players(id) ON DELETE SET NULL,
  pending_vice_id bigint REFERENCES public.draft_pool_players(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.draft_member_bonus (
  member_id uuid PRIMARY KEY REFERENCES public.draft_members(id) ON DELETE CASCADE,
  draft_id uuid NOT NULL REFERENCES public.draft_rooms(id) ON DELETE CASCADE,
  points numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS draft_member_bonus_draft_idx ON public.draft_member_bonus (draft_id);

ALTER TABLE public.draft_captains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_member_bonus ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS draft_captains_read ON public.draft_captains;
CREATE POLICY draft_captains_read ON public.draft_captains
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.draft_members m WHERE m.id = member_id AND public._is_draft_member(m.draft_id)));
DROP POLICY IF EXISTS draft_member_bonus_read ON public.draft_member_bonus;
CREATE POLICY draft_member_bonus_read ON public.draft_member_bonus
  FOR SELECT TO authenticated USING (public._is_draft_member(draft_id));
REVOKE ALL ON public.draft_captains, public.draft_member_bonus FROM anon, authenticated;
GRANT SELECT ON public.draft_captains, public.draft_member_bonus TO authenticated;

-- ---------------------------------------------------------------------------
-- Team identity
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.draft_set_team_identity(p_draft_id uuid, p_name text, p_emoji text, p_color text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := NULLIF(btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g')), '');
  v_emoji text := NULLIF(btrim(COALESCE(p_emoji, '')), '');
  v_color text := NULLIF(btrim(COALESCE(p_color, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._is_draft_member(p_draft_id) THEN
    RAISE EXCEPTION 'You are not in this draft';
  END IF;
  IF v_name IS NOT NULL AND length(v_name) NOT BETWEEN 2 AND 24 THEN
    RAISE EXCEPTION 'A team name must be 2 to 24 characters';
  END IF;
  IF v_emoji IS NOT NULL AND char_length(v_emoji) > 8 THEN
    RAISE EXCEPTION 'Use a single emoji';
  END IF;
  IF v_color IS NOT NULL AND v_color !~ '^#[0-9a-fA-F]{6}$' THEN
    RAISE EXCEPTION 'Colour must look like #10b981';
  END IF;
  UPDATE public.draft_members
  SET team_name = v_name, team_emoji = v_emoji, team_color = lower(v_color)
  WHERE draft_id = p_draft_id AND user_id = auth.uid();
  UPDATE public.draft_rooms SET updated_at = now() WHERE id = p_draft_id;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_set_team_identity(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_set_team_identity(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Captains
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.draft_set_captains_enabled(p_draft_id uuid, p_on boolean)
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
    RAISE EXCEPTION 'Only the host can switch captains on or off';
  END IF;
  UPDATE public.draft_rooms SET captains_enabled = COALESCE(p_on, false), updated_at = now() WHERE id = p_draft_id;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_set_captains_enabled(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_set_captains_enabled(uuid, boolean) TO authenticated;

-- Choose my Captain (2x) and optional Vice-captain (1.5x). Takes effect after the next points update.
CREATE OR REPLACE FUNCTION public.draft_set_captains(p_draft_id uuid, p_captain bigint, p_vice bigint DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member uuid;
  v_on boolean;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT m.id, d.captains_enabled, d.status INTO v_member, v_on, v_status
  FROM public.draft_members m JOIN public.draft_rooms d ON d.id = m.draft_id
  WHERE m.draft_id = p_draft_id AND m.user_id = auth.uid();
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'You are not in this draft';
  END IF;
  IF NOT v_on THEN
    RAISE EXCEPTION 'Captains are not switched on for this draft';
  END IF;
  IF v_status = 'LOBBY' THEN
    RAISE EXCEPTION 'The draft has not started';
  END IF;
  IF p_captain IS NULL THEN
    RAISE EXCEPTION 'Choose a captain';
  END IF;
  IF p_vice IS NOT NULL AND p_vice = p_captain THEN
    RAISE EXCEPTION 'The captain and vice-captain must be different players';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.draft_picks WHERE draft_id = p_draft_id AND member_id = v_member AND player_id = p_captain) THEN
    RAISE EXCEPTION 'The captain must be one of your players';
  END IF;
  IF p_vice IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.draft_picks WHERE draft_id = p_draft_id AND member_id = v_member AND player_id = p_vice) THEN
    RAISE EXCEPTION 'The vice-captain must be one of your players';
  END IF;

  INSERT INTO public.draft_captains (member_id, pending_captain_id, pending_vice_id, updated_at)
  VALUES (v_member, p_captain, p_vice, now())
  ON CONFLICT (member_id) DO UPDATE
  SET pending_captain_id = EXCLUDED.pending_captain_id, pending_vice_id = EXCLUDED.pending_vice_id, updated_at = now();
  UPDATE public.draft_rooms SET updated_at = now() WHERE id = p_draft_id;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_set_captains(uuid, bigint, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_set_captains(uuid, bigint, bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- Standings now include the captain bonus
-- ---------------------------------------------------------------------------
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
             + COALESCE((SELECT b.points FROM public.draft_member_bonus b WHERE b.member_id = m.id), 0) AS points
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

-- The nightly sync, now with captain bonuses (everything else as before).
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

  -- Captain bonus for the points gained since the last sync (before totals change).
  -- Only drafts with captains on, only captains still on the team.
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

-- Reset-to-zero now also clears captain bonuses.
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
  DELETE FROM public.draft_member_bonus WHERE draft_id = p_draft_id;

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
