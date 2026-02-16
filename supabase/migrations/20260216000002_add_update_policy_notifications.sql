-- Enable RLS on notifications if not already enabled
ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists to avoid error on rerun
DROP POLICY IF EXISTS "Enable update for users based on organization_id" ON "public"."notifications";

-- Create policy for UPDATE
CREATE POLICY "Enable update for users based on organization_id" ON "public"."notifications"
FOR UPDATE USING (
  organization_id IN (
    SELECT id FROM public.organizations 
    WHERE owner_id = auth.uid()
    OR organization_members @> jsonb_build_array(jsonb_build_object('member_uid', auth.uid()::text))
  )
) WITH CHECK (
  organization_id IN (
    SELECT id FROM public.organizations 
    WHERE owner_id = auth.uid()
    OR organization_members @> jsonb_build_array(jsonb_build_object('member_uid', auth.uid()::text))
  )
);
