-- Add skip_address_verification column to campaign_csv_address_lists
ALTER TABLE campaign_csv_address_lists 
ADD COLUMN skip_address_verification BOOLEAN DEFAULT false NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN campaign_csv_address_lists.skip_address_verification IS 'Flag to bypass PostGrid address verification for CSV-based campaigns';