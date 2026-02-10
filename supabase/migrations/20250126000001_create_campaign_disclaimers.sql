-- Create campaign_disclaimers table
CREATE TABLE IF NOT EXISTS campaign_disclaimers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disclaimer_text text NOT NULL,
  value boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE campaign_disclaimers ENABLE ROW LEVEL SECURITY;

-- Create policy for service role access (Edge Functions will use service role)
CREATE POLICY "Service role has full access"
  ON campaign_disclaimers FOR ALL USING (true) WITH CHECK (true);

-- Insert the three disclaimer values
INSERT INTO campaign_disclaimers (disclaimer_text, value) VALUES
  ('I confirm all campaign details are correct and approved for mailing.', true),
  ('I authorize the campaign cost of {cost} to be charged to my account.', true),
  ('I confirm referral has given proper consent and comply with local regulations.', true);
