-- Create postcard_sends table
-- Tracks individual postcards submitted to PostGrid per campaign,
-- including their current delivery status for analytics purposes.
--
-- Statuses mirror PostGrid's postcard lifecycle:
--   ready                  → created, will be printed on sendDate
--   printing               → given to printer, being processed
--   processed_for_delivery → handed off to local postal service
--   completed              → most likely delivered (PostGrid approximation)
--   cancelled              → cancelled, will never be sent

CREATE TABLE IF NOT EXISTS postcard_sends (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id           uuid        REFERENCES campaigns(id) ON DELETE CASCADE,
  organization_id       uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  postgrid_postcard_id  text        NOT NULL UNIQUE,
  postgrid_status       text        NOT NULL DEFAULT 'ready',
  address               text,
  created_at            timestamptz DEFAULT now(),
  status_updated_at     timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_postcard_sends_org_id    ON postcard_sends(organization_id);
CREATE INDEX idx_postcard_sends_campaign  ON postcard_sends(campaign_id);
CREATE INDEX idx_postcard_sends_status    ON postcard_sends(postgrid_status);
CREATE INDEX idx_postcard_sends_created   ON postcard_sends(created_at DESC);

-- Enable RLS
ALTER TABLE postcard_sends ENABLE ROW LEVEL SECURITY;

-- Service role full access (used by edge functions and WebSocket server)
CREATE POLICY "Service role can manage all postcard_sends"
  ON postcard_sends
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read their own organization's postcard sends
CREATE POLICY "Users can view postcard sends in their organization"
  ON postcard_sends
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(organization_members) AS m
        WHERE (m->>'member_uid')::uuid = auth.uid()
      )
    )
  );

COMMENT ON TABLE postcard_sends IS 'Individual postcard records sent via PostGrid, tracked per campaign for delivery analytics';
COMMENT ON COLUMN postcard_sends.postgrid_postcard_id IS 'PostGrid postcard ID (postcard_xxx) returned on creation';
COMMENT ON COLUMN postcard_sends.postgrid_status IS 'Current delivery status from PostGrid: ready | printing | processed_for_delivery | completed | cancelled';
COMMENT ON COLUMN postcard_sends.status_updated_at IS 'Last time postgrid_status was refreshed via syncPostcardStatuses';
