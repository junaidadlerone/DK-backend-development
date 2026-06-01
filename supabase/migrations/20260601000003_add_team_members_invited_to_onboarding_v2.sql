-- Re-add team_members_invited to onboarding.
-- The original add (20260601000001) was reverted by 20260601000002 mid-refactor.
-- The refactor is now being re-implemented as part of the 3-step agency
-- onboarding flow. V3 agency step 3 (the new final step) flips this to TRUE.

ALTER TABLE onboarding
  ADD COLUMN IF NOT EXISTS team_members_invited BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN onboarding.team_members_invited IS
  'V3 agency onboarding final step: TRUE once the user has completed (or dismissed) the invite-team-members step.';
