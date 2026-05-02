-- =============================================================================
-- Atomic bid: avoids lost updates when two users bid at once
-- Run in Supabase: SQL Editor → paste → Run once
--
-- Client: supabase.rpc('place_auction_bid', { p_room_id, p_increment })
-- =============================================================================

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
    timer_type = 'SOLD_TIMER'
  WHERE las.room_id = p_room_id;

  INSERT INTO public.bid_history (room_id, player_id, user_id, amount)
  VALUES (p_room_id, s.current_player_id, me_id, new_bid);
END;
$$;

REVOKE ALL ON FUNCTION public.place_auction_bid(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_auction_bid(uuid, bigint) TO authenticated;

COMMENT ON FUNCTION public.place_auction_bid(uuid, bigint) IS
  'Adds p_increment to current_bid under row lock; validates budget, squad, and top bidder.';
