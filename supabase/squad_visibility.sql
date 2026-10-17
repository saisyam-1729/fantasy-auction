-- Room members can read every squad in their room (role counts and recent buys).
-- Run once in Supabase: SQL Editor → paste → Run
-- Safe to re-run.

ALTER TABLE public.user_squads
  ADD COLUMN IF NOT EXISTS purchased_at timestamptz DEFAULT now();

ALTER TABLE public.user_squads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_squads_select_room ON public.user_squads;
CREATE POLICY user_squads_select_room ON public.user_squads
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.room_users owner
      JOIN public.room_users me ON me.room_id = owner.room_id
      WHERE owner.id = user_squads.room_user_id
        AND me.user_id = auth.uid()
    )
  );
