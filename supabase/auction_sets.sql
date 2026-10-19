-- =============================================================================
-- Auction by sets. Safe to re-run.
--
-- Adds a lot order 'sets' (rooms.auction_filters.sort = 'sets'): players come up
-- in IPL-style sets, and by base price high to low inside each set:
--   1 Marquee        base price ₹3 Cr or more, any role
--   2 Batters
--   3 All-rounders
--   4 Wicketkeepers
--   5 Bowlers
--   6 Emerging       base price ₹20 L or less (the uncapped pool), any role
-- Marquee and Emerging are decided first by price; the role sets take the rest.
-- Keep lib/sets.ts in step with _auction_set_rank.
--
-- This file re-defines auction_pick_next_lot (also defined in
-- auction_manual_and_filters.sql). It must run after that file; the existing
-- sorts and filters behave exactly as before.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._auction_set_rank(p_base bigint, p_type text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_base >= 30000000 THEN 1
    WHEN p_base <= 2000000 THEN 6
    WHEN upper(p_type) = 'BAT' THEN 2
    WHEN upper(p_type) IN ('ALL', 'AR') THEN 3
    WHEN upper(p_type) = 'WK' THEN 4
    ELSE 5
  END;
$$;

GRANT EXECUTE ON FUNCTION public._auction_set_rank(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.auction_pick_next_lot(p_room_id uuid, p_exclude uuid)
RETURNS TABLE (lot_id uuid, lot_base bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  af jsonb;
  sm text;
BEGIN
  SELECT COALESCE(r.auction_filters, '{}'::jsonb) INTO af FROM public.rooms r WHERE r.id = p_room_id;
  sm := COALESCE(af->>'sort', 'created_asc');

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
  ORDER BY
    CASE WHEN sm = 'sets' THEN public._auction_set_rank(pi.base_price, pi.player_type) END ASC,
    CASE WHEN sm IN ('sets', 'base_price_desc') THEN pi.base_price END DESC,
    CASE WHEN sm = 'base_price_asc' THEN pi.base_price END ASC,
    rp.player_inventory_id ASC,
    rp.id ASC
  LIMIT 1;
END;
$$;
