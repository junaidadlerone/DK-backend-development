-- Migration: Make zone_id nullable in launch_ready_campaign_data
-- Reason: To support CSV-based campaigns that do not have a location zone.
-- Date: 2026-04-12

ALTER TABLE launch_ready_campaign_data 
ALTER COLUMN zone_id DROP NOT NULL;

COMMENT ON COLUMN launch_ready_campaign_data.zone_id IS 'Reference to the location zone (nullable for CSV-based campaigns)';
