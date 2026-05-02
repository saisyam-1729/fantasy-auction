-- =============================================================================
-- Full auction reset (admin only): pause live state, unsell all lots, clear squads,
-- zero spends, remove bid history for this room. Use after a broken test run.
-- Run once in Supabase: SQL Editor → paste → Run
--
-- App: supabase.rpc('restart_room_auction', { p_room_id: '<room uuid>' })
-- =============================================================================

CREATE OR REPLACE FUNCTION public.restart_room_auction(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.rooms r
    WHERE r.id = p_room_id AND r.admin_user_id = auth.uid()
  ) AND NOT EXISTS (
    SELECT 1 FROM public.room_users ru
    WHERE ru.room_id = p_room_id
      AND ru.user_id = auth.uid()
      AND COALESCE(ru.is_admin, false) = true
  ) THEN
    RAISE EXCEPTION 'Only the room admin can reset this auction';
  END IF;

  DELETE FROM public.bid_history bh WHERE bh.room_id = p_room_id;

  DELETE FROM public.user_squads us
  USING public.room_users ru
  WHERE us.room_user_id = ru.id AND ru.room_id = p_room_id;

  UPDATE public.room_players rp
  SET
    status = 'UNSOLD',
    sold_price = null,
    sold_to_user_id = null
  WHERE rp.room_id = p_room_id;

  UPDATE public.room_users ru
  SET
    spent = 0,
    squad_count = 0
  WHERE ru.room_id = p_room_id;

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
END;
$$;

REVOKE ALL ON FUNCTION public.restart_room_auction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restart_room_auction(uuid) TO authenticated;

COMMENT ON FUNCTION public.restart_room_auction(uuid) IS
  'Admin-only: wipe this room''s auction progress (squads, spends, sold flags, bids, live state).';
