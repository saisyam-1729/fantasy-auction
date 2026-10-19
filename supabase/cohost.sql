-- =============================================================================
-- Co-hosts and host transfer. Safe to re-run.
--
-- Every host check already accepts room_users.is_admin = true (see
-- _auction_is_room_admin), so a co-host is simply another member with that flag.
-- Browsers cannot set it directly (room_users guard), so these functions do it:
--   admin_set_cohost     promote or demote a member
--   admin_transfer_host  hand the room over to another member
-- Any current host/co-host may use them, so a co-host can step in when the
-- original host's phone has died. The owner can never be demoted; a transfer
-- makes the previous owner a co-host.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_set_cohost(
  p_room_id uuid,
  p_room_user_id uuid,
  p_on boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target public.room_users%ROWTYPE;
  owner_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._auction_is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'Only a host can manage co-hosts';
  END IF;

  SELECT * INTO target FROM public.room_users WHERE id = p_room_user_id AND room_id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That player is not in this room';
  END IF;

  SELECT admin_user_id INTO owner_id FROM public.rooms WHERE id = p_room_id;
  IF NOT COALESCE(p_on, false) AND target.user_id = owner_id THEN
    RAISE EXCEPTION 'The host cannot be removed. Transfer the room first.';
  END IF;

  UPDATE public.room_users
  SET is_admin = COALESCE(p_on, false)
  WHERE id = p_room_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_cohost(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_cohost(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_transfer_host(p_room_id uuid, p_room_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target public.room_users%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public._auction_is_room_admin(p_room_id) THEN
    RAISE EXCEPTION 'Only a host can transfer the room';
  END IF;

  SELECT * INTO target FROM public.room_users WHERE id = p_room_user_id AND room_id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That player is not in this room';
  END IF;

  UPDATE public.rooms SET admin_user_id = target.user_id WHERE id = p_room_id;
  UPDATE public.room_users SET is_admin = true WHERE id = p_room_user_id;
  -- the previous owner keeps is_admin = true, so they stay a co-host
END;
$$;

REVOKE ALL ON FUNCTION public.admin_transfer_host(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_transfer_host(uuid, uuid) TO authenticated;
