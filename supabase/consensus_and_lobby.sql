-- Run in Supabase SQL Editor (once) for consensus start + joinable room list.
-- Quick fix for Ready button only: use FIX_READY_BUTTON.sql (smaller, one paste).
-- 1) Per-player ready flag
ALTER TABLE room_users ADD COLUMN IF NOT EXISTS ready_to_start BOOLEAN NOT NULL DEFAULT false;

-- 2) Joinable rooms (does NOT expose room_key)
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
    (SELECT COUNT(*)::integer FROM room_users ru WHERE ru.room_id = r.id) AS player_count,
    r.max_players,
    r.player_inventory_type,
    r.status
  FROM rooms r
  WHERE r.status = 'WAITING'
    AND (SELECT COUNT(*) FROM room_users ru WHERE ru.room_id = r.id) < r.max_players
  ORDER BY r.created_at DESC
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION public.list_joinable_rooms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_joinable_rooms() TO authenticated;

-- 3) REQUIRED for "I am ready": signed-in users may update their own room_users row.
-- (The app only sends ready_to_start. For production you can add a trigger to lock other columns.)
DROP POLICY IF EXISTS room_users_update_own ON room_users;
CREATE POLICY room_users_update_own ON room_users
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4) Optional RPC (app no longer calls this; safe to run for other clients / tooling)
-- Parameter order (p_ready, p_room_id) matches PostgREST/Supabase RPC alphabetical binding.
DROP FUNCTION IF EXISTS public.set_my_ready_state(uuid, boolean);
DROP FUNCTION IF EXISTS public.set_my_ready_state(boolean, uuid);

CREATE OR REPLACE FUNCTION public.set_my_ready_state(p_ready boolean, p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE room_users ru
  SET ready_to_start = p_ready
  WHERE ru.room_id = p_room_id AND ru.user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_ready_state(boolean, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_ready_state(boolean, uuid) TO authenticated;
