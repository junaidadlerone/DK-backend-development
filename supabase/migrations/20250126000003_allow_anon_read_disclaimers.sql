-- Allow anonymous read access to campaign_disclaimers for public endpoint
-- This is needed for /getAllConsents to work without authentication

CREATE POLICY "Allow anonymous read access to campaign disclaimers"
  ON campaign_disclaimers
  FOR SELECT
  USING (true);
