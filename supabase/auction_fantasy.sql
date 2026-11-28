-- =============================================================================
-- Fantasy leaderboards for AUCTION rooms. Safe to re-run.
-- Run after fantasy_points.sql.
--
-- Auction squads are scored by the same nightly player points as drafts, for event
-- lists that have a points source (ILT20). A player's points count from the moment
-- the lot is sold: a trigger on user_squads records the player's points at that
-- moment as an offset, and a team's score is the sum of (points now - offset).
-- Auction players are matched to the points pool by team and name.
--
-- auction_leaderboard returns the same JSON shape as draft_leaderboard, so one
-- screen draws both. snapshot_auction_standings (service role, called by the
-- nightly job after the points sync) stores each day's standings for the
-- rank / points movement.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.auction_point_offsets (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  pool_player_id bigint NOT NULL REFERENCES public.draft_pool_players(id) ON DELETE CASCADE,
  points numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, pool_player_id)
);

CREATE TABLE IF NOT EXISTS public.auction_standings_daily (
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  room_user_id uuid NOT NULL REFERENCES public.room_users(id) ON DELETE CASCADE,
  day date NOT NULL,
  points numeric NOT NULL,
  rank integer NOT NULL,
  PRIMARY KEY (room_id, room_user_id, day)
);
CREATE INDEX IF NOT EXISTS auction_standings_daily_idx ON public.auction_standings_daily (room_id, day);

ALTER TABLE public.auction_point_offsets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auction_standings_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auction_point_offsets, public.auction_standings_daily FROM anon, authenticated;
-- read only through auction_leaderboard

-- The pool player behind a sold auction lot (room_players.id), matched by team and name.
CREATE OR REPLACE FUNCTION public._auction_pool_player(p_room_player_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dp.id
  FROM public.room_players rp
  JOIN public.player_inventory pi ON pi.id = rp.player_inventory_id
  JOIN public.draft_pool_players dp
    ON dp.pool = pi.inventory_type AND lower(dp.team) = lower(COALESCE(pi.team, '')) AND lower(dp.player_name) = lower(pi.player_name)
  WHERE rp.id = p_room_player_id
  ORDER BY dp.id
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public._auction_pool_player(uuid) FROM PUBLIC, anon, authenticated;

-- When a lot is sold, remember the player's points at that moment.
CREATE OR REPLACE FUNCTION public._auction_squad_offset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room uuid;
  v_pool_player bigint;
BEGIN
  SELECT ru.room_id INTO v_room FROM public.room_users ru WHERE ru.id = NEW.room_user_id;
  v_pool_player := public._auction_pool_player(NEW.player_id);
  IF v_room IS NOT NULL AND v_pool_player IS NOT NULL THEN
    INSERT INTO public.auction_point_offsets (room_id, pool_player_id, points)
    VALUES (v_room, v_pool_player, COALESCE((SELECT pp.points FROM public.player_points pp WHERE pp.player_id = v_pool_player), 0))
    ON CONFLICT (room_id, pool_player_id) DO UPDATE SET points = EXCLUDED.points;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS auction_squad_offset ON public.user_squads;
CREATE TRIGGER auction_squad_offset AFTER INSERT ON public.user_squads
  FOR EACH ROW EXECUTE FUNCTION public._auction_squad_offset();

-- Points of every team in an auction room, ranked (ties share a rank).
CREATE OR REPLACE FUNCTION public._auction_current_standings(p_room_id uuid)
RETURNS TABLE (room_user_id uuid, points numeric, rank integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH totals AS (
    SELECT ru.id AS room_user_id,
           COALESCE(SUM(COALESCE(pp.points, 0) - COALESCE(o.points, 0)), 0) AS points
    FROM public.room_users ru
    LEFT JOIN public.user_squads us ON us.room_user_id = ru.id
    LEFT JOIN LATERAL (SELECT public._auction_pool_player(us.player_id) AS pid) m ON true
    LEFT JOIN public.player_points pp ON pp.player_id = m.pid
    LEFT JOIN public.auction_point_offsets o ON o.room_id = p_room_id AND o.pool_player_id = m.pid
    WHERE ru.room_id = p_room_id
    GROUP BY ru.id
  )
  SELECT room_user_id, points, (RANK() OVER (ORDER BY points DESC))::int FROM totals;
$$;
REVOKE ALL ON FUNCTION public._auction_current_standings(uuid) FROM PUBLIC, anon, authenticated;

-- The leaderboard of one auction room, in the shape draft_leaderboard returns.
CREATE OR REPLACE FUNCTION public.auction_leaderboard(p_room_id uuid)
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
  v_type text;
  result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._is_room_member(p_room_id) THEN
    RAISE EXCEPTION 'You are not in this room';
  END IF;

  SELECT player_inventory_type INTO v_type FROM public.rooms WHERE id = p_room_id;
  SELECT MAX(day) INTO v_latest FROM public.auction_standings_daily WHERE room_id = p_room_id;
  SELECT MAX(day) INTO v_prev FROM public.auction_standings_daily WHERE room_id = p_room_id AND day < v_latest;
  SELECT MAX(ran_at) INTO v_synced FROM public.points_sync_log WHERE pool = v_type;

  SELECT jsonb_build_object(
    'synced_at', v_synced,
    'latest_day', v_latest,
    'previous_day', v_prev,
    'rows', COALESCE(jsonb_agg(row ORDER BY (row->>'rank')::int, row->>'username'), '[]'::jsonb)
  )
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'member_id', ru.id,
      'username', COALESCE(NULLIF(ru.team_name, ''), ru.username),
      'user_id', ru.user_id,
      'order_pos', NULL,
      'points', cs.points,
      'rank', cs.rank,
      'prev_points', prev.points,
      'prev_rank', prev.rank,
      'players', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'player_id', m.pid,
          'name', dp.player_name,
          'team', dp.team,
          'role', dp.role,
          'points', COALESCE(pp.points, 0) - COALESCE(o.points, 0),
          'matches', COALESCE(pp.matches, 0),
          'prev_points', ppd.points - COALESCE(o.points, 0)
        ) ORDER BY COALESCE(pp.points, 0) - COALESCE(o.points, 0) DESC, dp.player_name), '[]'::jsonb)
        FROM public.user_squads us
        CROSS JOIN LATERAL (SELECT public._auction_pool_player(us.player_id) AS pid) m
        JOIN public.draft_pool_players dp ON dp.id = m.pid
        LEFT JOIN public.player_points pp ON pp.player_id = dp.id
        LEFT JOIN public.auction_point_offsets o ON o.room_id = p_room_id AND o.pool_player_id = dp.id
        LEFT JOIN public.player_points_daily ppd ON ppd.player_id = dp.id AND ppd.day = v_prev
        WHERE us.room_user_id = ru.id
      )
    ) AS row
    FROM public.room_users ru
    JOIN public._auction_current_standings(p_room_id) cs ON cs.room_user_id = ru.id
    LEFT JOIN public.auction_standings_daily prev
      ON prev.room_id = p_room_id AND prev.room_user_id = ru.id AND prev.day = v_prev
    WHERE ru.room_id = p_room_id
  ) t;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.auction_leaderboard(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auction_leaderboard(uuid) TO authenticated;

-- Store today's standings for every auction room on this event list that has squads.
-- The nightly job calls this right after sync_player_points.
CREATE OR REPLACE FUNCTION public.snapshot_auction_standings(p_pool text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
  v_day date := public._points_day();
BEGIN
  FOR r IN
    SELECT rm.id FROM public.rooms rm
    WHERE rm.player_inventory_type = p_pool
      AND EXISTS (SELECT 1 FROM public.room_users ru JOIN public.user_squads us ON us.room_user_id = ru.id WHERE ru.room_id = rm.id)
  LOOP
    INSERT INTO public.auction_standings_daily (room_id, room_user_id, day, points, rank)
    SELECT r.id, s.room_user_id, v_day, s.points, s.rank FROM public._auction_current_standings(r.id) s
    ON CONFLICT (room_id, room_user_id, day) DO UPDATE SET points = EXCLUDED.points, rank = EXCLUDED.rank;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.snapshot_auction_standings(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_auction_standings(text) TO service_role;
