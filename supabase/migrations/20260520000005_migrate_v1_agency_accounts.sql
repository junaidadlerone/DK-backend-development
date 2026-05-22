-- One-time data migration: split v1 multi-tenant accounts into a separate
-- agency-manager org + demoted business org.
--
-- Target: users who match the v1 pattern
--   * owns ≥ 1 org with is_agency = true (the v1 "agency" was the earliest org)
--   * owns ≥ 2 orgs total (multi-org pattern; single-org users are NOT migrated)
--   * profiles.multi_org_enabled = false (V3 sets this to true → its presence
--     proves the user has already been through V3 agency onboarding, so we skip)
--
-- For each such user:
--   1. Create a NEW org with is_agency=true (the agency manager). business_name
--      copies the old org's value with " Agency" appended.
--   2. Mirror createOrganization edge function: PERFORM create_default_app_content
--      and insert a blank onboarding row for the new org.
--   3. Flip the old is_agency=true org to is_agency=false (it becomes a sub-org).
--   4. Set profiles.multi_org_enabled = true and active_organization_id = new
--      org id so the user lands on the agency dashboard next login and V3
--      endpoints work for them immediately.
--
-- Idempotent: the predicate `multi_org_enabled = false` filters out anyone
-- already migrated, since step 4 flips that flag.

DO $$
DECLARE
  v_user uuid;
  v_old_org_id uuid;
  v_old_business_name text;
  v_new_org_id uuid;
  v_count int := 0;
BEGIN
  FOR v_user, v_old_org_id, v_old_business_name IN
    SELECT p.id, o.id, o.business_name
    FROM profiles p
    JOIN organizations o
      ON o.owner_id = p.id
     AND o.is_agency = true
    WHERE p.multi_org_enabled = false
      AND (SELECT COUNT(*) FROM organizations WHERE owner_id = p.id) >= 2
  LOOP
    -- 1. Create new agency-manager org
    INSERT INTO organizations (owner_id, is_agency, organization_members, business_name)
    VALUES (
      v_user,
      true,
      '[]'::jsonb,
      CASE WHEN v_old_business_name IS NULL
           THEN NULL
           ELSE v_old_business_name || ' Agency'
      END
    )
    RETURNING id INTO v_new_org_id;

    -- 2a. Seed default app_content rows (one per role).
    -- Non-fatal: a single org's failure should not abort the migration.
    BEGIN
      PERFORM create_default_app_content(v_new_org_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'create_default_app_content failed for org %: %', v_new_org_id, SQLERRM;
    END;

    -- 2b. Blank onboarding row
    INSERT INTO onboarding (organization_id) VALUES (v_new_org_id);

    -- 3. Demote the old agency org to a regular sub-org
    UPDATE organizations
       SET is_agency = false, updated_at = now()
     WHERE id = v_old_org_id;

    -- 4. Profile flags: enable multi-org + active org points at the new agency
    UPDATE profiles
       SET multi_org_enabled = true,
           active_organization_id = v_new_org_id,
           updated_at = now()
     WHERE id = v_user;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Migrated % v1 agency account(s) to V3 model', v_count;
END $$;
