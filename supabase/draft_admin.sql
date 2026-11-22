-- =============================================================================
-- Host tools for drafts, and the points sync status. Safe to re-run.
-- Run after draft.sql, fantasy_points.sql and draft_extras.sql.
--
-- These replace one-off scripts:
--   draft_host_replace_pick   swap the player of an earlier pick (a mistaken pick)
--   draft_host_add_player     add a player missing from the pool
--   draft_host_reset_points   count only points scored from now on
--   points_sync_status        when points last updated, and which names didn't match
-- =============================================================================

-- Swap the player of pick p_pick_no (0-based) for another available player.
CREATE OR REPLACE FUNCTION public.draft_host_replace_pick(p_draft_id uuid, p_pick_no integer, p_player_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._draft_is_host(p_draft_id) THEN
    RAISE EXCEPTION 'Only the host can change a pick';
  END IF;
  SELECT pool INTO v_pool FROM public.draft_rooms WHERE id = p_draft_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.draft_picks WHERE draft_id = p_draft_id AND pick_no = p_pick_no) THEN
    RAISE EXCEPTION 'There is no pick number %', p_pick_no + 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.draft_pool_players WHERE id = p_player_id AND pool = v_pool) THEN
    RAISE EXCEPTION 'That player is not in this pool';
  END IF;
  IF EXISTS (SELECT 1 FROM public.draft_picks WHERE draft_id = p_draft_id AND player_id = p_player_id) THEN
    RAISE EXCEPTION 'That player has already been picked';
  END IF;
  -- an UPDATE, so the pick timer (reset on insert/delete only) keeps running
  UPDATE public.draft_picks SET player_id = p_player_id, picked_by = auth.uid()
  WHERE draft_id = p_draft_id AND pick_no = p_pick_no;
  UPDATE public.draft_rooms SET updated_at = now() WHERE id = p_draft_id;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_host_replace_pick(uuid, integer, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_host_replace_pick(uuid, integer, bigint) TO authenticated;

-- Add a player missing from the draft's pool. Pools are shared by every draft of
-- the event, so the player appears in all of them; the note records who added it.
CREATE OR REPLACE FUNCTION public.draft_host_add_player(p_draft_id uuid, p_team text, p_name text, p_role text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pool text;
  v_team text := btrim(regexp_replace(COALESCE(p_team, ''), '\s+', ' ', 'g'));
  v_name text := btrim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));
  v_role text := NULLIF(btrim(COALESCE(p_role, '')), '');
  v_id bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._draft_is_host(p_draft_id) THEN
    RAISE EXCEPTION 'Only the host can add a player';
  END IF;
  IF length(v_name) NOT BETWEEN 2 AND 60 OR length(v_team) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'Enter the player''s name and team (2 to 60 characters each)';
  END IF;
  IF v_role IS NOT NULL AND v_role NOT IN ('Batter', 'Wicketkeeper', 'WK-Batter', 'All-rounder', 'Bowler') THEN
    RAISE EXCEPTION 'Unknown role %', v_role;
  END IF;
  SELECT pool INTO v_pool FROM public.draft_rooms WHERE id = p_draft_id;
  IF EXISTS (SELECT 1 FROM public.draft_pool_players WHERE pool = v_pool AND lower(team) = lower(v_team) AND lower(player_name) = lower(v_name)) THEN
    RAISE EXCEPTION '% is already in the pool', v_name;
  END IF;

  INSERT INTO public.draft_pool_players (pool, sort_no, team, player_name, role, notes)
  SELECT v_pool, COALESCE(MAX(sort_no), 0) + 1, v_team, v_name, v_role, 'Added by a host'
  FROM public.draft_pool_players WHERE pool = v_pool
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.draft_host_add_player(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_host_add_player(uuid, text, text, text) TO authenticated;

-- Host version of set_draft_points_baseline: points scored so far stop counting.
CREATE OR REPLACE FUNCTION public.draft_host_reset_points(p_draft_id uuid)
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
    RAISE EXCEPTION 'Only the host can reset the points';
  END IF;
  IF (SELECT status FROM public.draft_rooms WHERE id = p_draft_id) = 'LOBBY' THEN
    RAISE EXCEPTION 'The draft has not started';
  END IF;
  RETURN public.set_draft_points_baseline(p_draft_id);
END;
$$;
REVOKE ALL ON FUNCTION public.draft_host_reset_points(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.draft_host_reset_points(uuid) TO authenticated;

-- The last points update for a pool: when, how many rows, how many matched, and
-- the names that didn't match. Any signed-in user may read it.
CREATE OR REPLACE FUNCTION public.points_sync_status(p_pool text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object('ran_at', l.ran_at, 'day', l.day, 'source_rows', l.source_rows, 'matched', l.matched, 'unmatched', l.unmatched)
  FROM public.points_sync_log l
  WHERE l.pool = p_pool
  ORDER BY l.ran_at DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.points_sync_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.points_sync_status(text) TO authenticated;
