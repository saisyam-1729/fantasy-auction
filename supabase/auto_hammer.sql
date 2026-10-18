-- =============================================================================
-- Server-side lot finalization (optional per room). Safe to re-run.
--
-- Until now only the host's browser could sell a lot, so a closed tab stalled
-- the auction. With rooms.auto_hammer = true, ANY room member's browser may call
-- auction_finalize_expired(); the database checks the clock and, when the 30s
-- timer after the last bid has run out, sells to the top bidder. It re-checks
-- under a row lock, so many callers at once sell the lot exactly once.
--
-- * Off by default. Existing rooms behave exactly as before (host hammers).
-- * Only sells when there is a top bidder. A lot with no bids still waits for
--   the host (Pass), so nothing is skipped by accident.
-- * Paused lots never expire. Resuming resets the timer (auction_set_paused).
-- * The host's Hammer / Pass buttons keep working.
-- =============================================================================

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS auto_hammer boolean NOT NULL DEFAULT false;

-- The sale itself, with no caller checks. Not executable by API roles.
CREATE OR REPLACE FUNCTION public._auction_hammer(p_room_id uuid, p_action text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s live_auction_state%ROWTYPE;
  next_id uuid;
  next_base bigint;
  sold_rows integer := 0;
  now_ts timestamptz := clock_timestamp();
BEGIN
  IF lower(trim(p_action)) NOT IN ('sold', 'pass') THEN
    RAISE EXCEPTION 'Invalid action (use sold or pass)';
  END IF;

  SELECT * INTO s FROM public.live_auction_state WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR NOT s.is_active OR s.current_player_id IS NULL THEN
    RAISE EXCEPTION 'Auction is not active';
  END IF;

  IF lower(trim(p_action)) = 'sold' THEN
    IF s.top_bidder_id IS NULL THEN
      RAISE EXCEPTION 'No winning bid to sell to';
    END IF;

    UPDATE public.room_players rp
    SET status = 'SOLD', sold_price = s.current_bid, sold_to_user_id = s.top_bidder_id
    WHERE rp.id = s.current_player_id AND rp.room_id = p_room_id AND rp.status = 'UNSOLD';

    GET DIAGNOSTICS sold_rows = ROW_COUNT;
    IF sold_rows = 0 THEN
      RAISE EXCEPTION 'Could not sell this lot (already sold or invalid state)';
    END IF;

    INSERT INTO public.user_squads (room_user_id, player_id, purchase_price)
    VALUES (s.top_bidder_id, s.current_player_id, s.current_bid)
    ON CONFLICT (room_user_id, player_id) DO NOTHING;

    UPDATE public.room_users ru
    SET
      spent = COALESCE(ru.spent, 0) + s.current_bid,
      squad_count = COALESCE(ru.squad_count, 0) + 1
    WHERE ru.id = s.top_bidder_id AND ru.room_id = p_room_id;

    SELECT lot_id, lot_base INTO next_id, next_base
    FROM public.auction_pick_next_lot(p_room_id, NULL)
    LIMIT 1;
  ELSE
    SELECT lot_id, lot_base INTO next_id, next_base
    FROM public.auction_pick_next_lot(p_room_id, s.current_player_id)
    LIMIT 1;
  END IF;

  IF next_id IS NULL THEN
    UPDATE public.live_auction_state las
    SET
      is_active = false,
      current_player_id = null,
      current_bid = 0,
      top_bidder_id = null,
      start_time = null,
      last_bid_time = null,
      timer_type = null
    WHERE las.room_id = p_room_id;
  ELSE
    UPDATE public.live_auction_state las
    SET
      current_player_id = next_id,
      current_bid = next_base,
      top_bidder_id = null,
      start_time = now_ts,
      last_bid_time = now_ts,
      timer_type = null
    WHERE las.room_id = p_room_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._auction_hammer(uuid, text) FROM PUBLIC, anon, authenticated;

-- Host button: same checks as before, now delegating to the shared sale.
CREATE OR REPLACE FUNCTION public.auction_hammer_advance(p_room_id uuid, p_action text)
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
    RAISE EXCEPTION 'Only room admin can hammer / pass';
  END IF;
  PERFORM public._auction_hammer(p_room_id, p_action);
END;
$$;

REVOKE ALL ON FUNCTION public.auction_hammer_advance(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auction_hammer_advance(uuid, text) TO authenticated;

-- Any member may ask "has the timer run out?". Returns 'sold' or 'waiting'.
CREATE OR REPLACE FUNCTION public.auction_finalize_expired(p_room_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s live_auction_state%ROWTYPE;
  auto boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._is_room_member(p_room_id) THEN
    RAISE EXCEPTION 'You are not in this room';
  END IF;

  SELECT r.auto_hammer INTO auto FROM public.rooms r WHERE r.id = p_room_id;
  IF NOT COALESCE(auto, false) THEN
    RETURN 'waiting';
  END IF;

  SELECT * INTO s FROM public.live_auction_state WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND
     OR NOT s.is_active
     OR COALESCE(s.is_paused, false)
     OR s.current_player_id IS NULL
     OR s.top_bidder_id IS NULL
     OR s.last_bid_time IS NULL
     OR clock_timestamp() < s.last_bid_time + interval '30 seconds' THEN
    RETURN 'waiting';
  END IF;

  PERFORM public._auction_hammer(p_room_id, 'sold');
  RETURN 'sold';
END;
$$;

REVOKE ALL ON FUNCTION public.auction_finalize_expired(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auction_finalize_expired(uuid) TO authenticated;

-- Host switch, only before the auction starts.
CREATE OR REPLACE FUNCTION public.admin_set_auto_hammer(p_room_id uuid, p_on boolean)
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
    RAISE EXCEPTION 'Only room admin can change auto-sell';
  END IF;
  IF EXISTS (SELECT 1 FROM public.live_auction_state WHERE room_id = p_room_id AND is_active) THEN
    RAISE EXCEPTION 'Auto-sell can only be changed before the auction starts';
  END IF;
  UPDATE public.rooms SET auto_hammer = COALESCE(p_on, false) WHERE id = p_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_auto_hammer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_auto_hammer(uuid, boolean) TO authenticated;
