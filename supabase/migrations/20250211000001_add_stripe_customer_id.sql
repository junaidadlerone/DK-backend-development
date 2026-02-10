-- Add Stripe customer ID to organizations table
-- This links each organization to their Stripe customer account

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer_id
ON organizations(stripe_customer_id);

-- Add comment
COMMENT ON COLUMN organizations.stripe_customer_id IS 'Stripe customer ID for billing and payment methods';
