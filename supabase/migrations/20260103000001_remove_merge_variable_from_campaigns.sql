-- Drop the merge_variable column from campaigns table if it exists
alter table "public"."campaigns" drop column if exists "merge_variable";
