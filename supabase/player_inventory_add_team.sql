-- Optional: IPL franchise on each row (run once before seeding IPL 2026 from Excel)
-- Supabase → SQL Editor

ALTER TABLE public.player_inventory
  ADD COLUMN IF NOT EXISTS team text;

COMMENT ON COLUMN public.player_inventory.team IS 'IPL franchise code (e.g. RCB) when inventory_type is IPL.';
