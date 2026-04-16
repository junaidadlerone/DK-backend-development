-- Add imb_status column to postcard_sends
--
-- PostGrid provides two separate tracking fields on postcards destined for the US:
--
--   status    (standard lifecycle, all orders)
--     ready | printing | processed_for_delivery | completed | cancelled
--
--   imbStatus (Intelligent-Mail Tracking, US only — available once processed at a USPS facility)
--     entered_mail_stream | out_for_delivery | returned_to_sender
--
-- We store both separately so analytics can combine them accurately.
-- imbStatus is NULL for non-US orders or until the postcard enters a USPS facility.

ALTER TABLE postcard_sends
  ADD COLUMN IF NOT EXISTS imb_status text DEFAULT NULL;

CREATE INDEX idx_postcard_sends_imb_status ON postcard_sends(imb_status)
  WHERE imb_status IS NOT NULL;

COMMENT ON COLUMN postcard_sends.imb_status IS
  'PostGrid Intelligent-Mail Tracking status (US only, nullable). '
  'Populated once the postcard enters a USPS facility. '
  'Values: entered_mail_stream | out_for_delivery | returned_to_sender';
