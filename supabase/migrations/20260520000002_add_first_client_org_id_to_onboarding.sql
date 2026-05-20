-- Add first_client_org_id to onboarding so the agency V3 flow can remember which
-- sub-org it created during step 3, and resume steps 4 and 5 across browser refreshes.
-- ON DELETE SET NULL keeps the agency's onboarding row intact if the client sub-org is deleted later.

ALTER TABLE onboarding
  ADD COLUMN IF NOT EXISTS first_client_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN onboarding.first_client_org_id IS
  'Agency onboarding only: the client sub-org created in completeOnboardingV3 step 3.';
