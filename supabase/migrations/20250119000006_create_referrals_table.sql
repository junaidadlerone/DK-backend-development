-- Create Referrals table
CREATE TABLE IF NOT EXISTS referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_owner_info jsonb DEFAULT '{
    "name": "",
    "address": {
      "street": "",
      "city": "",
      "state": {"name": "", "abbreviation": ""},
      "zip": ""
    },
    "phone": "",
    "email": ""
  }'::jsonb,
  job_details jsonb DEFAULT '{
    "job_type": {"id": null, "name": ""},
    "value": 0,
    "currency": "USD",
    "referral_percentage": 0,
    "notes": ""
  }'::jsonb,
  status jsonb DEFAULT '{"id": null, "name": "Draft"}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for faster queries
CREATE INDEX idx_referrals_status ON referrals USING gin ((status));
CREATE INDEX idx_referrals_created_at ON referrals(created_at DESC);

-- Enable RLS
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can do everything (for edge functions)
CREATE POLICY "Service role can manage all referrals"
  ON referrals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can read all referrals
CREATE POLICY "Authenticated users can view referrals"
  ON referrals
  FOR SELECT
  TO authenticated
  USING (true);

-- Add comment
COMMENT ON TABLE referrals IS 'Referrals table storing home owner information, job details, and referral status';
