-- Multi-Org Phase 1: Database Foundation
-- Tasks: DB-001, DB-002, DB-003, DB-004, DB-005

-- DB-001: Drop UNIQUE constraint on organizations.owner_id
-- Allows one user to own multiple organizations
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_owner_id_key;

-- DB-002: Extend profiles table
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_super_admin          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS multi_org_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS active_organization_id  uuid REFERENCES organizations(id) ON DELETE SET NULL;

-- Backfill: all existing ADMIN users are Super Admins (they signed up via /signUp)
UPDATE profiles SET is_super_admin = true WHERE role = 'ADMIN';

-- DB-003: Add soft-delete support to organizations
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamptz DEFAULT null;

-- DB-004: Org switch audit log
CREATE TABLE IF NOT EXISTS org_switch_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  from_org_id  uuid REFERENCES organizations(id) ON DELETE SET NULL,
  to_org_id    uuid REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  switched_at  timestamptz DEFAULT now() NOT NULL
);

-- DB-005: Multi-org intent questionnaire answers
CREATE TABLE IF NOT EXISTS multi_org_intent (
  id                        uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                   uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reason_for_multiple_orgs  text,
  expected_org_count        text,
  teammate_overlap          text,
  created_at                timestamptz DEFAULT now() NOT NULL
);
