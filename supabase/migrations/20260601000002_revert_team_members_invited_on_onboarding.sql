-- Rollback of 20260601000001_add_team_members_invited_to_onboarding.sql.
-- The agency-onboarding 3-step refactor was reverted before completion;
-- restoring the onboarding table schema to its pre-refactor state.

ALTER TABLE onboarding DROP COLUMN IF EXISTS team_members_invited;
