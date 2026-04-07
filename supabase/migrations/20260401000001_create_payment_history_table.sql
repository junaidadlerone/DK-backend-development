-- Create payment_history table
-- Stores a record for each charge linked to a campaign (optional campaign_id)

CREATE TABLE IF NOT EXISTS payment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount_paid numeric(10, 2) NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  stripe_charge_id text,
  stripe_invoice_id text,
  coupon_applied text,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_payment_history_campaign_id ON payment_history(campaign_id);
CREATE INDEX idx_payment_history_organization_id ON payment_history(organization_id);
CREATE INDEX idx_payment_history_created_at ON payment_history(created_at DESC);

-- Enable RLS
ALTER TABLE payment_history ENABLE ROW LEVEL SECURITY;

-- Service role full access (used by edge functions)
CREATE POLICY "Service role can manage all payment_history"
  ON payment_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Authenticated users can read their own organization's payment history
CREATE POLICY "Users can view payment history in their organization"
  ON payment_history
  FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT id FROM organizations
      WHERE owner_id = auth.uid()
    )
  );

COMMENT ON TABLE payment_history IS 'Records each payment charge, optionally linked to a campaign';
COMMENT ON COLUMN payment_history.amount_paid IS 'Final amount charged in USD dollars (after any discount)';
COMMENT ON COLUMN payment_history.stripe_charge_id IS 'Stripe Charge ID (ch_xxx)';
COMMENT ON COLUMN payment_history.stripe_invoice_id IS 'Stripe Invoice ID (in_xxx) — present for invoice-based charges';
COMMENT ON COLUMN payment_history.coupon_applied IS 'Promotion Code string used at charge time, if any';
