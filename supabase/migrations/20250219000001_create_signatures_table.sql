-- Create signatures table
CREATE TABLE IF NOT EXISTS public.signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signature TEXT NOT NULL,
    proof_id UUID NOT NULL,
    proof_url TEXT NOT NULL,
    referral_id UUID DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add foreign key constraint for referral_id
ALTER TABLE public.signatures
ADD CONSTRAINT fk_signatures_referral
FOREIGN KEY (referral_id)
REFERENCES public.referrals(id)
ON DELETE SET NULL;

-- Add signature_id column to referrals table
ALTER TABLE public.referrals
ADD COLUMN IF NOT EXISTS signature_id UUID DEFAULT NULL;

-- Add foreign key constraint for signature_id
ALTER TABLE public.referrals
ADD CONSTRAINT fk_referrals_signature
FOREIGN KEY (signature_id)
REFERENCES public.signatures(id)
ON DELETE SET NULL;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_signatures_referral_id ON public.signatures(referral_id);
CREATE INDEX IF NOT EXISTS idx_referrals_signature_id ON public.referrals(signature_id);

-- Enable Row Level Security
ALTER TABLE public.signatures ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for signatures table
-- Policy: Service role can manage all signatures
CREATE POLICY "Service role can manage all signatures"
  ON public.signatures
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Policy: Authenticated users can view all signatures
CREATE POLICY "Authenticated users can view signatures"
  ON public.signatures
  FOR SELECT
  TO authenticated
  USING (true);
