-- =============================================================================
-- Live updates for auction rooms. Safe to re-run.
--
-- rooms (settings, owner) and room_players (sold / unsold) were not in the
-- realtime publication, so screens polled every few seconds to notice changes.
-- With them published, the room page (hooks/useRoomSync) hears sales at once and
-- only polls slowly as a safety net. Both tables already have member-only
-- SELECT policies, which realtime respects.
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY['rooms', 'room_players', 'live_auction_state', 'room_users'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      END IF;
    END LOOP;
  END IF;
END $$;
