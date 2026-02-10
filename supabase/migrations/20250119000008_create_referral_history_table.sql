-- Create referral_history table
CREATE TABLE IF NOT EXISTS referral_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  user_name text NOT NULL,
  action text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX idx_referral_history_referral_id ON referral_history(referral_id);
CREATE INDEX idx_referral_history_user_id ON referral_history(user_id);
CREATE INDEX idx_referral_history_created_at ON referral_history(created_at DESC);

-- Enable RLS
ALTER TABLE referral_history ENABLE ROW LEVEL SECURITY;

-- Create policies
-- Service role policy (full access)
CREATE POLICY "Service role has full access to referral_history"
  ON referral_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read all referral history
CREATE POLICY "Authenticated users can read referral_history"
  ON referral_history
  FOR SELECT
  TO authenticated
  USING (true);

-- Add comment
COMMENT ON TABLE referral_history IS 'Logs all actions performed on referrals with user information';
