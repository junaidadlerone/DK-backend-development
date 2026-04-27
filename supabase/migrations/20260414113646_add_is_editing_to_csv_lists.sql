-- Add is_editing column to campaign_csv_address_lists
ALTER TABLE campaign_csv_address_lists 
ADD COLUMN is_editing BOOLEAN DEFAULT true;
