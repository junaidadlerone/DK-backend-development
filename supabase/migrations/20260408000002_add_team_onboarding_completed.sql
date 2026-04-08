-- Track whether the user has completed step 4 (team assignment) of onboarding
ALTER TABLE onboarding
ADD COLUMN IF NOT EXISTS team_onboarding_completed BOOLEAN DEFAULT false;

COMMENT ON COLUMN onboarding.team_onboarding_completed IS 'Whether the team assignment step (step 4) of onboarding has been completed';
