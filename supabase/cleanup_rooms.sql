-- =============================================================================
-- Clean up stale rooms. Safe to re-run.
--
-- A room is stale when nothing has happened in it for p_days days: no bid, no
-- player heartbeat, no change to the room or its auction state. Every room copies
-- the whole player list (250 rows), so abandoned rooms add up.
-- Deleting a room cascades to its members, players, squads, bids and auction state.
--
--   select * from public.cleanup_stale_rooms(30);          -- dry run: just lists them
--   select * from public.cleanup_stale_rooms(30, false);   -- actually deletes
--
-- Not callable from the browser (no grants to anon/authenticated). Run it from the
-- SQL editor or with `npm run db:cleanup` (dry run unless --apply).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_stale_rooms(
  p_days integer DEFAULT 30,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE (
  room_id text,
  last_activity timestamptz,
  members bigint,
  sold bigint,
  deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
BEGIN
  IF p_days IS NULL OR p_days < 1 THEN
    RAISE EXCEPTION 'p_days must be at least 1';
  END IF;

  FOR rec IN
    SELECT r.id AS rid,
           r.room_id AS code,
           GREATEST(
             r.created_at,
             r.updated_at,
             l.updated_at,
             (SELECT MAX(b.created_at) FROM public.bid_history b WHERE b.room_id = r.id),
             (SELECT MAX(u.last_seen_at) FROM public.room_users u WHERE u.room_id = r.id)
           ) AS last_act,
           (SELECT COUNT(*) FROM public.room_users u WHERE u.room_id = r.id) AS n_members,
           (SELECT COUNT(*) FROM public.room_players p WHERE p.room_id = r.id AND p.status = 'SOLD') AS n_sold
    FROM public.rooms r
    LEFT JOIN public.live_auction_state l ON l.room_id = r.id
    WHERE GREATEST(
            r.created_at,
            r.updated_at,
            l.updated_at,
            (SELECT MAX(b.created_at) FROM public.bid_history b WHERE b.room_id = r.id),
            (SELECT MAX(u.last_seen_at) FROM public.room_users u WHERE u.room_id = r.id)
          ) < clock_timestamp() - make_interval(days => p_days)
    ORDER BY 3
  LOOP
    IF NOT p_dry_run THEN
      DELETE FROM public.rooms WHERE id = rec.rid;
    END IF;
    room_id := rec.code;
    last_activity := rec.last_act;
    members := rec.n_members;
    sold := rec.n_sold;
    deleted := NOT p_dry_run;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_stale_rooms(integer, boolean) FROM PUBLIC, anon, authenticated;
