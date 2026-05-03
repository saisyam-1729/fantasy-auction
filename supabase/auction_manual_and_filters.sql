-- =============================================================================
-- Manual auction (no countdown timers) + host filters for lot order
-- Run once in Supabase: SQL Editor → paste → Run
--
-- Replaces timer-based finalize. Client calls:
--   auction_start_first_lot(p_room_id)
--   auction_hammer_advance(p_room_id, p_action)  -- p_action: 'sold' | 'pass'
--   admin_set_auction_filters(p_room_id, p_filters jsonb)
-- =============================================================================

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS auction_filters jsonb NOT NULL DEFAULT '{
    "sort": "created_asc",
    "player_types": null,
    "min_base_price": null,
    "max_base_price": null
  }'::jsonb;

COMMENT ON COLUMN public.rooms.auction_filters IS
  'sort: created_asc | base_price_asc | base_price_desc. player_types: json array of strings or null/empty = all. min/max_base_price: rupees (bigint as json number).';

-- Drop old timer-based finalizer (optional; safe if missing)
DROP FUNCTION IF EXISTS public.finalize_auction_if_expired(uuid);

CREATE OR REPLACE FUNCTION public.auction_pick_next_lot(p_room_id uuid, p_exclude uuid)
RETURNS TABLE (lot_id uuid, lot_base bigint)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  af jsonb;
  sm text;
BEGIN
  SELECT COALESCE(r.auction_filters, '{}'::jsonb) INTO af FROM public.rooms r WHERE r.id = p_room_id;
  sm := COALESCE(af->>'sort', 'created_asc');

  IF sm = 'base_price_asc' THEN
    RETURN QUERY
    SELECT rp.id, pi.base_price
    FROM public.room_players rp
    INNER JOIN public.player_inventory pi ON pi.id = rp.player_inventory_id
    WHERE rp.room_id = p_room_id
      AND rp.status = 'UNSOLD'
      AND (p_exclude IS NULL OR rp.id <> p_exclude)
      AND (
        NOT (af ? 'player_types') OR af->'player_types' IS NULL
        OR jsonb_typeof(af->'player_types') <> 'array'
        OR jsonb_array_length(af->'player_types') = 0
        OR pi.player_type IN (SELECT j.elem::text FROM jsonb_array_elements_text(af->'player_types') AS j(elem))
      )
      AND (
        NOT (af ? 'min_base_price') OR af->>'min_base_price' IS NULL OR af->>'min_base_price' = 'null'
        OR pi.base_price >= (af->>'min_base_price')::bigint
      )
      AND (
        NOT (af ? 'max_base_price') OR af->>'max_base_price' IS NULL OR af->>'max_base_price' = 'null'
        OR pi.base_price <= (af->>'max_base_price')::bigint
      )
    ORDER BY pi.base_price ASC, rp.created_at ASC
    LIMIT 1;
    RETURN;
  END IF;

  IF sm = 'base_price_desc' THEN
    RETURN QUERY
    SELECT rp.id, pi.base_price
    FROM public.room_players rp
    INNER JOIN public.player_inventory pi ON pi.id = rp.player_inventory_id
    WHERE rp.room_id = p_room_id
      AND rp.status = 'UNSOLD'
      AND (p_exclude IS NULL OR rp.id <> p_exclude)
      AND (
        NOT (af ? 'player_types') OR af->'player_types' IS NULL
        OR jsonb_typeof(af->'player_types') <> 'array'
        OR jsonb_array_length(af->'player_types') = 0
        OR pi.player_type IN (SELECT j.elem::text FROM jsonb_array_elements_text(af->'player_types') AS j(elem))
      )
      AND (
        NOT (af ? 'min_base_price') OR af->>'min_base_price' IS NULL OR af->>'min_base_price' = 'null'
        OR pi.base_price >= (af->>'min_base_price')::bigint
      )
      AND (
        NOT (af ? 'max_base_price') OR af->>'max_base_price' IS NULL OR af->>'max_base_price' = 'null'
        OR pi.base_price <= (af->>'max_base_price')::bigint
      )
    ORDER BY pi.base_price DESC, rp.created_at ASC
    LIMIT 1;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT rp.id, pi.base_price
  FROM public.room_players rp
  INNER JOIN public.player_inventory pi ON pi.id = rp.player_inventory_id
  WHERE rp.room_id = p_room_id
    AND rp.status = 'UNSOLD'
    AND (p_exclude IS NULL OR rp.id <> p_exclude)
    AND (
      NOT (af ? 'player_types') OR af->'player_types' IS NULL
      OR jsonb_typeof(af->'player_types') <> 'array'
      OR jsonb_array_length(af->'player_types') = 0
      OR pi.player_type IN (SELECT j.elem::text FROM jsonb_array_elements_text(af->'player_types') AS j(elem))
    )
    AND (
      NOT (af ? 'min_base_price') OR af->>'min_base_price' IS NULL OR af->>'min_base_price' = 'null'
      OR pi.base_price >= (af->>'min_base_price')::bigint
    )
    AND (
      NOT (af ? 'max_base_price') OR af->>'max_base_price' IS NULL OR af->>'max_base_price' = 'null'
      OR pi.base_price <= (af->>'max_base_price')::bigint
    )
  ORDER BY rp.created_at ASC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public._auction_is_room_admin(p_room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.id = p_room_id AND r.admin_user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.room_users ru
    WHERE ru.room_id = p_room_id AND ru.user_id = auth.uid() AND COALESCE(ru.is_admin, false) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_set_auction_filters(p_room_id uuid, p_filters jsonb)
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
    RAISE EXCEPTION 'Only room admin can change auction filters';
  END IF;

  UPDATE public.rooms r
  SET auction_filters = COALESCE(p_filters, '{}'::jsonb)
  WHERE r.id = p_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.auction_start_first_lot(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s live_auction_state%ROWTYPE;
  lid uuid;
  b bigint;
  now_ts timestamptz := clock_timestamp();
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.room_users ru WHERE ru.room_id = p_room_id AND ru.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'You are not in this room';
  END IF;

  SELECT * INTO s FROM public.live_auction_state WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No live_auction_state for this room';
  END IF;
  IF s.is_active THEN
    RAISE EXCEPTION 'Auction already active';
  END IF;

  SELECT lot_id, lot_base INTO lid, b
  FROM public.auction_pick_next_lot(p_room_id, NULL)
  LIMIT 1;

  IF lid IS NULL THEN
    RAISE EXCEPTION 'No unsold players match the current filters. Widen filters or reset the room.';
  END IF;

  UPDATE public.live_auction_state las
  SET
    is_active = true,
    current_player_id = lid,
    current_bid = b,
    top_bidder_id = null,
    start_time = now_ts,
    last_bid_time = now_ts,
    timer_type = null
  WHERE las.room_id = p_room_id;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'Could not start auction state';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.auction_hammer_advance(p_room_id uuid, p_action text)
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._auction_is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'Only room admin can hammer / pass';
  END IF;

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
    -- pass: no sale; advance to another lot matching filters
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

-- Bids: no timer mode flag
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
    timer_type = null
  WHERE las.room_id = p_room_id;

  INSERT INTO public.bid_history (room_id, player_id, user_id, amount)
  VALUES (p_room_id, s.current_player_id, me_id, new_bid);
END;
$$;

REVOKE ALL ON FUNCTION public.auction_pick_next_lot(uuid, uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public._auction_is_room_admin(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.admin_set_auction_filters(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_auction_filters(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.auction_start_first_lot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auction_start_first_lot(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.auction_hammer_advance(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auction_hammer_advance(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.place_auction_bid(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_auction_bid(uuid, bigint) TO authenticated;
