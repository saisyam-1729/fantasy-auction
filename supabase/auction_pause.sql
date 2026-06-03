-- =============================================================================
-- Auction pause / resume support
-- Run once in Supabase: SQL Editor → paste → Run
--
-- Adds is_paused column to live_auction_state and a host-only RPC:
--   auction_set_paused(p_room_id, p_paused)
--
-- When paused:  bidding is blocked server-side; countdown freezes client-side
-- When resumed: last_bid_time resets to now so the countdown restarts fresh
-- =============================================================================

ALTER TABLE public.live_auction_state
  ADD COLUMN IF NOT EXISTS is_paused boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.live_auction_state.is_paused IS
  'When true the host has paused this lot. Bids are rejected and the countdown is frozen.';

-- Also block bids while paused inside the existing place_auction_bid function
CREATE OR REPLACE FUNCTION public.place_auction_bid(p_room_id uuid, p_increment bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s live_auction_state%ROWTYPE;
  me_id uuid;
  bud bigint;
  sp bigint;
  sq integer;
  new_bid bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_increment IS NULL OR p_increment <= 0 THEN
    RAISE EXCEPTION 'Invalid increment';
  END IF;

  SELECT ru.id, ru.budget, COALESCE(ru.spent, 0), COALESCE(ru.squad_count, 0)
  INTO me_id, bud, sp, sq
  FROM public.room_users ru
  WHERE ru.room_id = p_room_id AND ru.user_id = auth.uid();

  IF me_id IS NULL THEN
    RAISE EXCEPTION 'You are not in this room';
  END IF;
  IF sq >= 25 THEN
    RAISE EXCEPTION 'Squad full (25 players max)';
  END IF;

  SELECT * INTO s FROM public.live_auction_state WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auction state not found';
  END IF;
  IF NOT s.is_active OR s.current_player_id IS NULL THEN
    RAISE EXCEPTION 'Auction is not active';
  END IF;
  IF COALESCE(s.is_paused, false) THEN
    RAISE EXCEPTION 'Auction is paused — wait for the host to resume';
  END IF;
  IF s.top_bidder_id IS NOT DISTINCT FROM me_id THEN
    RAISE EXCEPTION 'You already hold the highest bid';
  END IF;

  new_bid := s.current_bid + p_increment;
  IF new_bid > (bud - sp) THEN
    RAISE EXCEPTION 'Insufficient funds';
  END IF;

  UPDATE public.live_auction_state las
  SET
    current_bid = new_bid,
    top_bidder_id = me_id,
    last_bid_time = clock_timestamp(),
    timer_type = null
  WHERE las.room_id = p_room_id;

  INSERT INTO public.bid_history (room_id, player_id, user_id, amount)
  VALUES (p_room_id, s.current_player_id, me_id, new_bid);
END;
$$;

CREATE OR REPLACE FUNCTION public.auction_set_paused(p_room_id uuid, p_paused boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s live_auction_state%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._auction_is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'Only room admin can pause / resume the auction';
  END IF;

  SELECT * INTO s FROM public.live_auction_state WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR NOT s.is_active THEN
    RAISE EXCEPTION 'No active auction to pause or resume';
  END IF;

  IF p_paused THEN
    -- Pause: freeze the state
    UPDATE public.live_auction_state
    SET is_paused = true
    WHERE room_id = p_room_id;
  ELSE
    -- Resume: reset last_bid_time so countdown restarts from full duration
    UPDATE public.live_auction_state
    SET is_paused = false,
        last_bid_time = clock_timestamp()
    WHERE room_id = p_room_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.auction_set_paused(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auction_set_paused(uuid, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.place_auction_bid(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_auction_bid(uuid, bigint) TO authenticated;
