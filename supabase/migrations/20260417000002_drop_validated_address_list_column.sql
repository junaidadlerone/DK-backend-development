-- ============================================================
-- Drop deprecated validated_address_list column
-- All consumers now read directly from addresses[]
-- using is_reachable / is_valid / is_duplicate flags.
-- ============================================================

ALTER TABLE campaign_csv_address_lists
  DROP COLUMN IF EXISTS validated_address_list;
