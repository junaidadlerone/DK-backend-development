-- Revert adding start_date and end_date to campaigns table
ALTER TABLE "public"."campaigns" 
DROP COLUMN IF EXISTS "start_date",
DROP COLUMN IF EXISTS "end_date";
