-- Add is_agency flag to organizations
-- TRUE  = created via signup (original/primary org, "agency account")
-- FALSE = created via createOrganization multi-tenant API (sub-org)
-- All existing orgs default to TRUE since they predate multi-tenancy.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS is_agency BOOLEAN NOT NULL DEFAULT TRUE;
