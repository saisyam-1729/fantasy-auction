-- =============================================================================
-- Bid slabs
-- Run once in Supabase: SQL Editor → paste → Run
-- (after auction_pause.sql so pause checks stay in place)
--
-- place_auction_bid accepts only the next slab step:
--   current bid <  ₹2 Cr  → +₹10 L  (under ₹1 Cr and ₹1–2 Cr combined)
--   current bid <  ₹5 Cr  → +₹20 L
--   current bid >= ₹5 Cr  → +₹25 L
-- A step that would pass ₹2 Cr or ₹5 Cr lands exactly on that boundary.
--
-- Purse lock: after the bid, the purse must still cover the cheapest other
-- unsold base price for every slot still needed to reach rooms.min_squad_size.
-- Slots above the minimum (up to rooms.max_squad_size) do not lock money.
-- Defaults: minimum 12, maximum 15. Host sets both via admin_set_squad_sizes.
-- Slots with no unsold player left are not reserved.
-- =============================================================================

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS min_squad_size integer NOT NULL DEFAULT 12;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS max_squad_size integer NOT NULL DEFAULT 15;

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_squad_size_range;
ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_squad_size_range
  CHECK (
    min_squad_size >= 1
    AND min_squad_size <= max_squad_size
    AND max_squad_size <= 30
  );

CREATE OR REPLACE FUNCTION public.admin_set_squad_sizes(
  p_room_id uuid,
  p_min integer,
  p_max integer
)
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
    RAISE EXCEPTION 'Only room admin can change squad size';
  END IF;
  IF p_min IS NULL OR p_max IS NULL OR p_min < 1 OR p_max > 30 OR p_min > p_max THEN
    RAISE EXCEPTION 'Squad size must be from 1 to 30, and the minimum cannot exceed the maximum';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.live_auction_state las
    WHERE las.room_id = p_room_id AND las.is_active
  ) THEN
    RAISE EXCEPTION 'Squad size can only be changed before the auction starts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.room_users ru
    WHERE ru.room_id = p_room_id AND COALESCE(ru.squad_count, 0) > p_max
  ) THEN
    RAISE EXCEPTION 'A team already has more players than that maximum';
  END IF;

  UPDATE public.rooms
  SET min_squad_size = p_min,
      max_squad_size = p_max
  WHERE id = p_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_squad_sizes(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_squad_sizes(uuid, integer, integer) TO authenticated;

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
  expected_increment bigint;
  other_unsold integer;
  min_base bigint;
  slots_left integer;
  reserve_slots integer;
  reserved bigint;
  min_squad integer;
  max_squad integer;
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

  SELECT COALESCE(r.min_squad_size, 12), COALESCE(r.max_squad_size, 15)
  INTO min_squad, max_squad
  FROM public.rooms r
  WHERE r.id = p_room_id;

  IF min_squad IS NULL OR min_squad < 1 THEN
    min_squad := 12;
  END IF;
  IF max_squad IS NULL OR max_squad < min_squad THEN
    max_squad := GREATEST(min_squad, 15);
  END IF;
  IF sq >= max_squad THEN
    RAISE EXCEPTION 'Squad full (% players max)', max_squad;
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

  -- Slab step from the price being left. Snap onto ₹2 Cr / ₹5 Cr when a step would cross them.
  IF s.current_bid < 20000000 THEN
    expected_increment := 1000000;
    IF s.current_bid + expected_increment > 20000000 THEN
      expected_increment := 20000000 - s.current_bid;
    END IF;
  ELSIF s.current_bid < 50000000 THEN
    expected_increment := 2000000;
    IF s.current_bid + expected_increment > 50000000 THEN
      expected_increment := 50000000 - s.current_bid;
    END IF;
  ELSE
    expected_increment := 2500000;
  END IF;

  IF p_increment <> expected_increment THEN
    RAISE EXCEPTION 'Bid must be the next slab step';
  END IF;

  new_bid := s.current_bid + p_increment;
  IF new_bid > (bud - sp) THEN
    RAISE EXCEPTION 'Insufficient funds';
  END IF;

  SELECT COUNT(*)::integer, MIN(pi.base_price)
  INTO other_unsold, min_base
  FROM public.room_players rp
  INNER JOIN public.player_inventory pi ON pi.id = rp.player_inventory_id
  WHERE rp.room_id = p_room_id
    AND rp.status = 'UNSOLD'
    AND rp.id IS DISTINCT FROM s.current_player_id;

  other_unsold := COALESCE(other_unsold, 0);
  min_base := COALESCE(min_base, 0);
  slots_left := GREATEST(min_squad - sq, 0);
  reserve_slots := LEAST(GREATEST(slots_left - 1, 0), other_unsold);
  reserved := reserve_slots * min_base;

  IF new_bid > (bud - sp - reserved) THEN
    RAISE EXCEPTION 'Bid would leave too little to fill the remaining slots';
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

REVOKE ALL ON FUNCTION public.place_auction_bid(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_auction_bid(uuid, bigint) TO authenticated;

COMMENT ON FUNCTION public.place_auction_bid(uuid, bigint) IS
  'Next slab step only. Purse must cover the cheapest other unsold base price for each slot still needed to reach the room minimum squad size.';
