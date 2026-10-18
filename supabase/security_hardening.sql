-- =============================================================================
-- Security hardening. Safe to re-run.
-- Run in Supabase SQL Editor (or: node with SUPABASE_DB_URL).
--
-- Fixes found by auditing RLS and function grants:
--  1. Any member could UPDATE their own room_users row, including budget,
--     spent, squad_count and is_admin.
--  2. Any user could INSERT their own room_users row with any budget / is_admin.
--  3. Anyone could INSERT into user_squads and bid_history (any user, any amount).
--  4. Any user could INSERT live_auction_state for any room.
--  5. Room admins could UPDATE live_auction_state / room_players directly,
--     bypassing the auction functions.
--  6. rooms was readable by everyone, including room_key (the join password).
--  7. room_users was readable across all rooms.
--  8. initialize_room_players had no admin check and was not idempotent.
-- The app only needs: create room, join room, set own ready flag, read its room.
-- All money / squad changes already go through SECURITY DEFINER functions.
-- =============================================================================

-- Membership helper (SECURITY DEFINER avoids RLS recursion on room_users).
CREATE OR REPLACE FUNCTION public._is_room_member(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.room_users ru
    WHERE ru.room_id = p_room_id AND ru.user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public._is_room_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_room_member(uuid) TO authenticated;

-- 1 + 2. Guard room_users. Runs as the caller, so current_user is the API role
-- for browser requests and the function owner inside SECURITY DEFINER functions.
CREATE OR REPLACE FUNCTION public._room_users_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.budget := 1000000000;  -- same as the column default (₹100 Cr)
      NEW.spent := 0;
      NEW.squad_count := 0;
      NEW.is_admin := EXISTS (
        SELECT 1 FROM public.rooms r
        WHERE r.id = NEW.room_id AND r.admin_user_id = auth.uid()
      );
    ELSE
      IF NEW.budget IS DISTINCT FROM OLD.budget
         OR NEW.spent IS DISTINCT FROM OLD.spent
         OR NEW.squad_count IS DISTINCT FROM OLD.squad_count
         OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.room_id IS DISTINCT FROM OLD.room_id THEN
        RAISE EXCEPTION 'Only ready_to_start can be changed directly';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS room_users_guard ON public.room_users;
CREATE TRIGGER room_users_guard
  BEFORE INSERT OR UPDATE ON public.room_users
  FOR EACH ROW EXECUTE FUNCTION public._room_users_guard();

DROP POLICY IF EXISTS allow_update_own_room_user ON public.room_users;
-- room_users_update_own stays: members may update their own row (guarded above).

DROP POLICY IF EXISTS allow_select_room_users ON public.room_users;
DROP POLICY IF EXISTS room_users_select_room ON public.room_users;
CREATE POLICY room_users_select_room ON public.room_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public._is_room_member(room_id));

-- 3. Only the auction functions write squads and bids.
DROP POLICY IF EXISTS "System can insert into squads" ON public.user_squads;
DROP POLICY IF EXISTS "Room members can place bids" ON public.bid_history;

-- 4. Only the room admin may create the auction state row.
DROP POLICY IF EXISTS "System can insert auction state" ON public.live_auction_state;
DROP POLICY IF EXISTS live_auction_state_insert_admin ON public.live_auction_state;
CREATE POLICY live_auction_state_insert_admin ON public.live_auction_state
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.id = live_auction_state.room_id AND r.admin_user_id = auth.uid()
  ));

-- 5. No direct edits to the live lot or to who owns which player.
DROP POLICY IF EXISTS "Admins can update auction state" ON public.live_auction_state;
DROP POLICY IF EXISTS "Admins can update room players" ON public.room_players;

-- 6. rooms: only the admin and members can read a room (and its room_key).
DROP POLICY IF EXISTS "Anyone can view rooms" ON public.rooms;
DROP POLICY IF EXISTS rooms_select_member ON public.rooms;
CREATE POLICY rooms_select_member ON public.rooms
  FOR SELECT TO authenticated
  USING (admin_user_id = auth.uid() OR public._is_room_member(id));

-- Join by room id + key without exposing keys to non-members.
CREATE OR REPLACE FUNCTION public.join_room(p_room_id text, p_room_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.rooms%ROWTYPE;
  uname text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO r FROM public.rooms
  WHERE room_id = p_room_id AND room_key = p_room_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid Room ID or Room Key';
  END IF;

  IF EXISTS (SELECT 1 FROM public.room_users WHERE room_id = r.id AND user_id = auth.uid()) THEN
    RETURN r.id;
  END IF;

  IF (SELECT COUNT(*) FROM public.room_users WHERE room_id = r.id) >= COALESCE(r.max_players, 10) THEN
    RAISE EXCEPTION 'Room is full (max % players)', COALESCE(r.max_players, 10);
  END IF;

  SELECT COALESCE(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1), 'user')
  INTO uname
  FROM auth.users u WHERE u.id = auth.uid();

  INSERT INTO public.room_users (room_id, user_id, username, display_name, is_admin, ready_to_start)
  VALUES (r.id, auth.uid(), uname, r.room_id || '_' || uname, false, false);

  RETURN r.id;
END;
$$;
REVOKE ALL ON FUNCTION public.join_room(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_room(text, text) TO authenticated;

-- 8. Only the room admin can load players, and only once per room.
CREATE OR REPLACE FUNCTION public.initialize_room_players(p_room_id uuid, p_inventory_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._auction_is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'Only room admin can load players';
  END IF;
  IF EXISTS (SELECT 1 FROM public.room_players WHERE room_id = p_room_id) THEN
    RETURN;
  END IF;

  INSERT INTO public.room_players (room_id, player_inventory_id, status)
  SELECT p_room_id, id, 'UNSOLD'
  FROM public.player_inventory
  WHERE inventory_type = p_inventory_type;
END;
$$;
REVOKE ALL ON FUNCTION public.initialize_room_players(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.initialize_room_players(uuid, text) TO authenticated;

-- Signed-out callers should not even reach these.
REVOKE EXECUTE ON FUNCTION public.place_auction_bid(uuid, bigint) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_squad_sizes(uuid, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_auction_filters(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.auction_hammer_advance(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.auction_set_paused(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.auction_start_first_lot(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.restart_room_auction(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_joinable_rooms() FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_my_ready_state(boolean, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.initialize_room_players(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.join_room(text, text) FROM anon;
