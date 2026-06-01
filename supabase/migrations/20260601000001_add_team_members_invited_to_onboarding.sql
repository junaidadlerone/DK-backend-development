-- V3 agency onboarding now ends with an "invite team members" step instead of
-- the old "first client branding" step. team_members_invited is the boolean
-- the new step 3 sets to TRUE when the user finishes (or skips) inviting their
-- team. Replaces branding-based completion as the agency-flow's final signal.
--
-- Default FALSE so existing onboarding rows (legacy agencies that completed
-- the old 5-step flow) remain unaffected. profiles.onboarding = true still
-- short-circuits getOnboardingStepV3 for those users, so they won't be asked
-- to re-do step 3.

ALTER TABLE onboarding
  ADD COLUMN IF NOT EXISTS team_members_invited BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN onboarding.team_members_invited IS
  'V3 agency onboarding final step: TRUE once the user has completed (or dismissed) the invite-team-members step.';
