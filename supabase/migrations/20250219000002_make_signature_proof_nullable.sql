-- Make signature, proof_id, and proof_url nullable in signatures table
-- This allows uploading either signature OR proof OR both

ALTER TABLE public.signatures
ALTER COLUMN signature DROP NOT NULL;

ALTER TABLE public.signatures
ALTER COLUMN proof_id DROP NOT NULL;

ALTER TABLE public.signatures
ALTER COLUMN proof_url DROP NOT NULL;
