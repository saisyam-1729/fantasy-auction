-- =============================================================================
-- Indexes for the queries the app and RLS policies actually run. Safe to re-run.
--
--  * room_players (room_id, status): lot picking, "unsold" counts, purse lock.
--  * room_players (sold_to_user_id): squad and leaderboard lookups.
--  * room_users (user_id): every RLS membership check filters on user_id.
--  * user_squads (player_id): undo-last-sale and per-player lookups.
--  * bid_history (player_id, created_at DESC): history for the current lot.
-- =============================================================================

CREATE INDEX IF NOT EXISTS room_players_room_status_idx
  ON public.room_players (room_id, status);

CREATE INDEX IF NOT EXISTS room_players_sold_to_idx
  ON public.room_players (sold_to_user_id);

CREATE INDEX IF NOT EXISTS room_users_user_id_idx
  ON public.room_users (user_id);

CREATE INDEX IF NOT EXISTS user_squads_player_id_idx
  ON public.user_squads (player_id);

CREATE INDEX IF NOT EXISTS bid_history_player_created_idx
  ON public.bid_history (player_id, created_at DESC);
