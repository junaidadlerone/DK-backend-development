-- Drop policy if exists to make sure we replace it
DROP POLICY IF EXISTS "Enable update for users based on organization_id" ON "public"."notifications";

-- Create policy for UPDATE with corrected casting
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
