-- migration script to add or update postgrid_tracker_id to TEXT
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'campaigns'
        AND column_name = 'postgrid_tracker_id'
    ) THEN
        ALTER TABLE public.campaigns ADD COLUMN postgrid_tracker_id TEXT;
    ELSE
        ALTER TABLE public.campaigns ALTER COLUMN postgrid_tracker_id TYPE TEXT;
    END IF;
END $$;

COMMENT ON COLUMN public.campaigns.postgrid_tracker_id IS 'PostGrid tracker ID for QR code tracking';
