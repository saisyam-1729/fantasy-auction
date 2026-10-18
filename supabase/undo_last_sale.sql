-- =============================================================================
-- Host tool: undo the most recent sale. Safe to re-run.
--
-- Reverses the last SOLD lot (squad row, spend, squad count), then reopens that
-- lot as the current lot at the price it sold for, held by the same bidder, and
-- PAUSED so the host decides what happens next (resume, hammer, or pass).
-- Whatever lot was live at the time stays unsold and returns to the pool.
-- "Skip lot" needs no new function: Pass already moves a lot back in the queue.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.auction_undo_last_sale(p_room_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s live_auction_state%ROWTYPE;
  last_sale record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._auction_is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'Only room admin can undo a sale';
  END IF;

  SELECT * INTO s FROM public.live_auction_state WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Auction state not found';
  END IF;

  SELECT us.id AS squad_id,
         us.player_id,
         us.room_user_id,
         us.purchase_price
  INTO last_sale
  FROM public.user_squads us
  INNER JOIN public.room_users ru ON ru.id = us.room_user_id
  WHERE ru.room_id = p_room_id
  ORDER BY us.purchased_at DESC NULLS LAST, us.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nothing to undo: no player has been sold';
  END IF;

  UPDATE public.room_players
  SET status = 'UNSOLD', sold_price = NULL, sold_to_user_id = NULL, sold_at = NULL
  WHERE id = last_sale.player_id AND room_id = p_room_id;

  DELETE FROM public.user_squads WHERE id = last_sale.squad_id;

  UPDATE public.room_users
  SET spent = GREATEST(COALESCE(spent, 0) - last_sale.purchase_price, 0),
      squad_count = GREATEST(COALESCE(squad_count, 0) - 1, 0)
  WHERE id = last_sale.room_user_id AND room_id = p_room_id;

  UPDATE public.live_auction_state
  SET is_active = true,
      is_paused = true,
      current_player_id = last_sale.player_id,
      current_bid = last_sale.purchase_price,
      top_bidder_id = last_sale.room_user_id,
      start_time = clock_timestamp(),
      last_bid_time = clock_timestamp(),
      timer_type = NULL
  WHERE room_id = p_room_id;

  RETURN 'undone';
END;
$$;

REVOKE ALL ON FUNCTION public.auction_undo_last_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auction_undo_last_sale(uuid) TO authenticated;
