-- =============================================================================
-- Pause reasons, host "Close auction" message, and auto-pause when a player drops.
-- Safe to re-run.
--
-- A pause now has a reason:
--   host    the host pressed Pause (also the default)
--   away    a player stopped sending heartbeats mid-auction
--   closed  the host closed the auction, optionally with a message for everyone
-- All three block bids, freeze the timer, block auto-sell, and are cleared by the
-- host's Resume (auction_set_paused(false)), which also restarts the lot timer.
--
-- Away detection: each browser calls auction_heartbeat() every ~10s while the
-- auction is live. A member counts as AWAY when they were seen after the latest
-- start/resume but not in the last 45s. People already gone when the host
-- resumed are not counted again, so the host can carry on without them.
-- =============================================================================

ALTER TABLE public.live_auction_state
  ADD COLUMN IF NOT EXISTS pause_reason text,
  ADD COLUMN IF NOT EXISTS pause_message text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS resumed_at timestamptz;

ALTER TABLE public.room_users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Keep the reason fields consistent whichever function changes the pause flag.
CREATE OR REPLACE FUNCTION public._live_state_pause_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.is_active, false) AND NOT COALESCE(OLD.is_active, false) THEN
    -- auction started
    NEW.pause_reason := NULL;
    NEW.pause_message := NULL;
    NEW.paused_at := NULL;
    NEW.resumed_at := clock_timestamp();
  ELSIF COALESCE(OLD.is_paused, false) AND NOT COALESCE(NEW.is_paused, false) THEN
    -- resumed
    NEW.pause_reason := NULL;
    NEW.pause_message := NULL;
    NEW.paused_at := NULL;
    NEW.resumed_at := clock_timestamp();
  ELSIF COALESCE(NEW.is_paused, false) AND NOT COALESCE(OLD.is_paused, false) THEN
    -- paused
    NEW.pause_reason := COALESCE(NEW.pause_reason, 'host');
    NEW.paused_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS live_state_pause_fields ON public.live_auction_state;
CREATE TRIGGER live_state_pause_fields
  BEFORE UPDATE ON public.live_auction_state
  FOR EACH ROW EXECUTE FUNCTION public._live_state_pause_fields();

-- Host closes the auction for now. Resume later with the normal Resume.
CREATE OR REPLACE FUNCTION public.auction_close(p_room_id uuid, p_message text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s live_auction_state%ROWTYPE;
  msg text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._auction_is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'Only room admin can close the auction';
  END IF;

  SELECT * INTO s FROM public.live_auction_state WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR NOT s.is_active THEN
    RAISE EXCEPTION 'No active auction to close';
  END IF;

  msg := NULLIF(btrim(left(btrim(COALESCE(p_message, '')), 280)), '');

  UPDATE public.live_auction_state
  SET is_paused = true,
      pause_reason = 'closed',
      pause_message = msg
  WHERE room_id = p_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.auction_close(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auction_close(uuid, text) TO authenticated;

-- Every browser calls this ~every 10s while the auction is live. Records "seen"
-- and pauses the auction if someone else has dropped. Returns 'paused' or 'ok'.
CREATE OR REPLACE FUNCTION public.auction_heartbeat(p_room_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s live_auction_state%ROWTYPE;
  since timestamptz;
  names text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._is_room_member(p_room_id) THEN
    RAISE EXCEPTION 'You are not in this room';
  END IF;

  UPDATE public.room_users
  SET last_seen_at = clock_timestamp()
  WHERE room_id = p_room_id AND user_id = auth.uid();

  SELECT * INTO s FROM public.live_auction_state WHERE room_id = p_room_id;
  IF NOT FOUND OR NOT s.is_active OR COALESCE(s.is_paused, false) THEN
    RETURN 'ok';
  END IF;

  since := COALESCE(s.resumed_at, s.start_time);
  IF since IS NULL THEN
    RETURN 'ok';
  END IF;

  SELECT string_agg(ru.display_name, ', ' ORDER BY ru.display_name)
  INTO names
  FROM public.room_users ru
  WHERE ru.room_id = p_room_id
    AND ru.last_seen_at IS NOT NULL
    AND ru.last_seen_at >= since
    AND ru.last_seen_at < clock_timestamp() - interval '45 seconds';

  IF names IS NULL THEN
    RETURN 'ok';
  END IF;

  -- Re-check under the row lock so simultaneous callers pause once.
  SELECT * INTO s FROM public.live_auction_state WHERE room_id = p_room_id FOR UPDATE;
  IF NOT s.is_active OR COALESCE(s.is_paused, false) THEN
    RETURN 'ok';
  END IF;

  UPDATE public.live_auction_state
  SET is_paused = true,
      pause_reason = 'away',
      pause_message = left('Disconnected: ' || names, 280)
  WHERE room_id = p_room_id;
  RETURN 'paused';
END;
$$;

REVOKE ALL ON FUNCTION public.auction_heartbeat(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auction_heartbeat(uuid) TO authenticated;
