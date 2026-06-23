-- Fix location_zones.mode CHECK constraint.
--
-- The original constraint (migration 20250119000015) only allowed
-- mode IN ('radius', 'count'). However the address-discovery edge function
-- (supabase/functions/WebSocket/discoveraddresses) resolves and stores two
-- additional modes — 'polygon' (custom drawn area) and 'budget' — which the
-- constraint rejected, causing finalize to fail with:
--   new row for relation "location_zones" violates check constraint
--   "location_zones_mode_check"
-- The zone then never linked to the campaign and the campaign couldn't launch.
--
-- Widen the allowed set to match the modes the code actually produces.

ALTER TABLE location_zones
  DROP CONSTRAINT IF EXISTS location_zones_mode_check;

ALTER TABLE location_zones
  ADD CONSTRAINT location_zones_mode_check
  CHECK (mode IN ('radius', 'count', 'polygon', 'budget'));
