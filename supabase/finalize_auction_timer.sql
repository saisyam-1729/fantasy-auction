-- =============================================================================
-- DEPRECATED: timer-based flow removed. Use `auction_manual_and_filters.sql`
-- (auction_hammer_advance + host controls). This file is kept for reference.
-- =============================================================================
-- Hammer / pass when auction timers expire (fixes "timer runs but nothing happens")
-- Run in Supabase: SQL Editor → paste → Run once
--
-- Client polls: supabase.rpc('finalize_auction_if_expired', { p_room_id: '<uuid>' })
-- =============================================================================

CREATE OR REPLACE FUNCTION public.finalize_auction_if_expired(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s live_auction_state%ROWTYPE;
  now_ts timestamptz := clock_timestamp();
  deadline timestamptz;
  next_id uuid;
  next_base bigint;
  sold_rows integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.room_users ru
    WHERE ru.room_id = p_room_id AND ru.user_id = auth.uid()
  ) THEN
    RETURN false;
  END IF;

  SELECT * INTO s FROM public.live_auction_state WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND OR NOT s.is_active OR s.current_player_id IS NULL THEN
    RETURN false;
  END IF;

  IF s.timer_type = 'SOLD_TIMER' AND s.last_bid_time IS NOT NULL THEN
    deadline := s.last_bid_time + interval '15 seconds';
  ELSIF s.timer_type = 'UNSOLD_TIMER' AND s.start_time IS NOT NULL THEN
    deadline := s.start_time + interval '45 seconds';
  ELSE
    RETURN false;
  END IF;

  IF now_ts < deadline THEN
    RETURN false;
  END IF;

  -- Hammer: sell only when there is a bidder and this lot is still open
  IF s.top_bidder_id IS NOT NULL THEN
    UPDATE public.room_players rp
    SET
      status = 'SOLD',
      sold_price = s.current_bid,
      sold_to_user_id = s.top_bidder_id
    WHERE rp.id = s.current_player_id
      AND rp.room_id = p_room_id
      AND rp.status = 'UNSOLD';

    GET DIAGNOSTICS sold_rows = ROW_COUNT;

    IF sold_rows > 0 THEN
      INSERT INTO public.user_squads (room_user_id, player_id, purchase_price)
      VALUES (s.top_bidder_id, s.current_player_id, s.current_bid)
      ON CONFLICT (room_user_id, player_id) DO NOTHING;

      UPDATE public.room_users ru
      SET
        spent = COALESCE(ru.spent, 0) + s.current_bid,
        squad_count = COALESCE(ru.squad_count, 0) + 1
      WHERE ru.id = s.top_bidder_id
        AND ru.room_id = p_room_id;
    END IF;
  END IF;

  -- Next lot: after a sale, current row is SOLD so it drops out of UNSOLD.
  -- After a pass (no bidder), current stays UNSOLD — skip same player to avoid looping.
  IF s.top_bidder_id IS NOT NULL THEN
    SELECT rp.id, pi.base_price
    INTO next_id, next_base
    FROM public.room_players rp
    INNER JOIN public.player_inventory pi ON pi.id = rp.player_inventory_id
    WHERE rp.room_id = p_room_id
      AND rp.status = 'UNSOLD'
    ORDER BY rp.created_at ASC
    LIMIT 1;
  ELSE
    SELECT rp.id, pi.base_price
    INTO next_id, next_base
    FROM public.room_players rp
    INNER JOIN public.player_inventory pi ON pi.id = rp.player_inventory_id
    WHERE rp.room_id = p_room_id
      AND rp.status = 'UNSOLD'
      AND rp.id <> s.current_player_id
    ORDER BY rp.created_at ASC
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
      timer_type = 'UNSOLD_TIMER'
    WHERE las.room_id = p_room_id;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_auction_if_expired(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_auction_if_expired(uuid) TO authenticated;

COMMENT ON FUNCTION public.finalize_auction_if_expired(uuid) IS
  'When UNSOLD (45s) or SOLD (15s) timer has passed, sell if there is a top bidder, then advance or end.';
