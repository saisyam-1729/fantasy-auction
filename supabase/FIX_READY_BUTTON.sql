-- =============================================================================
-- Run ONCE in Supabase: Dashboard → SQL Editor → New query → paste → Run
--
-- Fixes:
--   • "ready_to_start" column / Ready button
--   • "list_joinable_rooms" / Join room → open rooms list
--   • Realtime publication so other players see Ready without manual refresh
-- =============================================================================

-- 1) Column on room_users (safe to re-run)
ALTER TABLE public.room_users
  ADD COLUMN IF NOT EXISTS ready_to_start BOOLEAN NOT NULL DEFAULT false;

-- 2) RLS: allow each user to update their own row (needed for Ready toggle)
DROP POLICY IF EXISTS room_users_update_own ON public.room_users;
CREATE POLICY room_users_update_own ON public.room_users
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3) Join lobby: RPC used by the app (does NOT expose room_key)
CREATE OR REPLACE FUNCTION public.list_joinable_rooms()
RETURNS TABLE (
  id uuid,
  room_id text,
  room_name text,
  player_count integer,
  max_players integer,
  player_inventory_type text,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.room_id,
    r.room_name,
    (SELECT COUNT(*)::integer FROM public.room_users ru WHERE ru.room_id = r.id) AS player_count,
    r.max_players,
    r.player_inventory_type,
    r.status
  FROM public.rooms r
  WHERE r.status = 'WAITING'
    AND (SELECT COUNT(*) FROM public.room_users ru WHERE ru.room_id = r.id) < r.max_players
  ORDER BY r.created_at DESC
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.list_joinable_rooms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_joinable_rooms() TO authenticated;

-- 4) Realtime: other players see Ready / roster changes without refreshing.
-- If a line errors with "already member of publication", that table is already enabled — skip it.
ALTER PUBLICATION supabase_realtime ADD TABLE public.room_users;
ALTER PUBLICATION supabase_realtime ADD TABLE public.live_auction_state;
