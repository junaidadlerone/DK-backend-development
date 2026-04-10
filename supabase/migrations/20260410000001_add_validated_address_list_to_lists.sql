-- Migration: Add validated_address_list to campaign_csv_address_lists
-- Date: 2026-04-10

ALTER TABLE campaign_csv_address_lists 
ADD COLUMN IF NOT EXISTS validated_address_list jsonb DEFAULT '[]'::jsonb;

COMMENT ON COLUMN campaign_csv_address_lists.validated_address_list IS 'Stores the final set of addresses targetable by the campaign after validation process';
