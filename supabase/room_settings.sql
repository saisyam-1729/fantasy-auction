-- =============================================================================
-- Per-room settings: starting budget, lot timer length and bid steps. Safe to re-run.
--
--   rooms.budget             starting purse for every team, in rupees  (default ₹100 Cr)
--   rooms.bid_timer_seconds  seconds after the last bid before a lot can sell (default 30)
--   rooms.slab_config        bid steps, or NULL for the default 10 L / 20 L / 25 L:
--                            { "t1": 20000000, "t2": 50000000,
--                              "s1": 1000000,  "s2": 2000000,  "s3": 2500000 }
--                            below t1 raise by s1, from t1 to t2 by s2, above t2 by s3.
--                            A step that would cross t1 or t2 lands exactly on it.
--
-- Defaults reproduce the old fixed behaviour exactly, so existing rooms are
-- unchanged. This file re-defines place_auction_bid, auction_finalize_expired,
-- join_room and the room_users guard to read the settings; it must run after the
-- files that define them (auction_bid_slabs, auto_hammer, security_hardening), and
-- be the LAST definition of place_auction_bid.
-- =============================================================================

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS budget bigint NOT NULL DEFAULT 1000000000,
  ADD COLUMN IF NOT EXISTS bid_timer_seconds integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS slab_config jsonb;

-- Is this a usable slab config? NULL means "use the defaults".
CREATE OR REPLACE FUNCTION public._auction_slab_valid(cfg jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t1 numeric; t2 numeric; s1 numeric; s2 numeric; s3 numeric;
BEGIN
  IF cfg IS NULL THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(cfg) <> 'object' THEN
    RETURN false;
  END IF;
  -- A missing key gives NULL here, and NULL <> 'number' is NULL, not true, so test with COALESCE.
  IF COALESCE(jsonb_typeof(cfg->'t1'), '') <> 'number' OR COALESCE(jsonb_typeof(cfg->'t2'), '') <> 'number'
     OR COALESCE(jsonb_typeof(cfg->'s1'), '') <> 'number' OR COALESCE(jsonb_typeof(cfg->'s2'), '') <> 'number'
     OR COALESCE(jsonb_typeof(cfg->'s3'), '') <> 'number' THEN
    RETURN false;
  END IF;
  t1 := (cfg->>'t1')::numeric; t2 := (cfg->>'t2')::numeric;
  s1 := (cfg->>'s1')::numeric; s2 := (cfg->>'s2')::numeric; s3 := (cfg->>'s3')::numeric;
  RETURN t1 >= 100000 AND t2 > t1 AND t2 <= 100000000000
     AND s1 >= 100000 AND s2 >= 100000 AND s3 >= 100000
     AND s1 <= 1000000000 AND s2 <= 1000000000 AND s3 <= 1000000000
     AND t1 = trunc(t1) AND t2 = trunc(t2) AND s1 = trunc(s1) AND s2 = trunc(s2) AND s3 = trunc(s3);
END;
$$;

ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_settings_check;
ALTER TABLE public.rooms
  ADD CONSTRAINT rooms_settings_check
  CHECK (
    budget >= 10000000 AND budget <= 1000000000000
    AND bid_timer_seconds >= 10 AND bid_timer_seconds <= 120
    AND public._auction_slab_valid(slab_config)
  );

-- The raise a bid must make from p_current in this room.
CREATE OR REPLACE FUNCTION public._auction_slab_increment(p_room_id uuid, p_current bigint)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  cfg jsonb;
  t1 bigint := 20000000; t2 bigint := 50000000;
  s1 bigint := 1000000;  s2 bigint := 2000000;  s3 bigint := 2500000;
  inc bigint;
BEGIN
  SELECT r.slab_config INTO cfg FROM public.rooms r WHERE r.id = p_room_id;
  IF cfg IS NOT NULL AND public._auction_slab_valid(cfg) THEN
    t1 := (cfg->>'t1')::bigint; t2 := (cfg->>'t2')::bigint;
    s1 := (cfg->>'s1')::bigint; s2 := (cfg->>'s2')::bigint; s3 := (cfg->>'s3')::bigint;
  END IF;

  IF p_current < t1 THEN
    inc := s1;
    IF p_current + inc > t1 THEN inc := t1 - p_current; END IF;
  ELSIF p_current < t2 THEN
    inc := s2;
    IF p_current + inc > t2 THEN inc := t2 - p_current; END IF;
  ELSE
    inc := s3;
  END IF;
  RETURN inc;
END;
$$;

GRANT EXECUTE ON FUNCTION public._auction_slab_increment(uuid, bigint) TO authenticated;

-- Bids: same rules as before, with the step read from the room.
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

  expected_increment := public._auction_slab_increment(p_room_id, s.current_bid);
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

REVOKE ALL ON FUNCTION public.place_auction_bid(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.place_auction_bid(uuid, bigint) TO authenticated;

-- Auto-sell: the lot timer is now the room's setting, not a fixed 30 seconds.
CREATE OR REPLACE FUNCTION public.auction_finalize_expired(p_room_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s live_auction_state%ROWTYPE;
  auto boolean;
  secs integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._is_room_member(p_room_id) THEN
    RAISE EXCEPTION 'You are not in this room';
  END IF;

  SELECT r.auto_hammer, r.bid_timer_seconds INTO auto, secs FROM public.rooms r WHERE r.id = p_room_id;
  IF NOT COALESCE(auto, false) THEN
    RETURN 'waiting';
  END IF;

  SELECT * INTO s FROM public.live_auction_state WHERE room_id = p_room_id FOR UPDATE;
  IF NOT FOUND
     OR NOT s.is_active
     OR COALESCE(s.is_paused, false)
     OR s.current_player_id IS NULL
     OR s.top_bidder_id IS NULL
     OR s.last_bid_time IS NULL
     OR clock_timestamp() < s.last_bid_time + make_interval(secs => COALESCE(secs, 30)) THEN
    RETURN 'waiting';
  END IF;

  PERFORM public._auction_hammer(p_room_id, 'sold');
  RETURN 'sold';
END;
$$;

REVOKE ALL ON FUNCTION public.auction_finalize_expired(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auction_finalize_expired(uuid) TO authenticated;

-- Members start with the room's budget (no longer a fixed ₹100 Cr).
CREATE OR REPLACE FUNCTION public._room_users_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.budget := COALESCE((SELECT r.budget FROM public.rooms r WHERE r.id = NEW.room_id), 1000000000);
      NEW.spent := 0;
      NEW.squad_count := 0;
      NEW.is_admin := EXISTS (
        SELECT 1 FROM public.rooms r
        WHERE r.id = NEW.room_id AND r.admin_user_id = auth.uid()
      );
    ELSE
      IF NEW.budget IS DISTINCT FROM OLD.budget
         OR NEW.spent IS DISTINCT FROM OLD.spent
         OR NEW.squad_count IS DISTINCT FROM OLD.squad_count
         OR NEW.is_admin IS DISTINCT FROM OLD.is_admin
         OR NEW.user_id IS DISTINCT FROM OLD.user_id
         OR NEW.room_id IS DISTINCT FROM OLD.room_id THEN
        RAISE EXCEPTION 'Only ready_to_start can be changed directly';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_room(p_room_id text, p_room_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.rooms%ROWTYPE;
  uname text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO r FROM public.rooms
  WHERE room_id = p_room_id AND room_key = p_room_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid Room ID or Room Key';
  END IF;

  IF EXISTS (SELECT 1 FROM public.room_users WHERE room_id = r.id AND user_id = auth.uid()) THEN
    RETURN r.id;
  END IF;

  IF (SELECT COUNT(*) FROM public.room_users WHERE room_id = r.id) >= COALESCE(r.max_players, 10) THEN
    RAISE EXCEPTION 'Room is full (max % players)', COALESCE(r.max_players, 10);
  END IF;

  SELECT COALESCE(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1), 'user')
  INTO uname
  FROM auth.users u WHERE u.id = auth.uid();

  INSERT INTO public.room_users (room_id, user_id, username, display_name, budget, is_admin, ready_to_start)
  VALUES (r.id, auth.uid(), uname, r.room_id || '_' || uname, r.budget, false, false);

  RETURN r.id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_room(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_room(text, text) TO authenticated;
