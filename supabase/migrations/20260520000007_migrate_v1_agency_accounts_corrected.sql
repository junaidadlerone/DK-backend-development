-- v1 → V3 agency migration (CORRECTED predicate).
--
-- Replaces the no-op migration 20260520000005 — that one used
--   `profiles.multi_org_enabled = false`
-- as the V3-exclusion signal, but it turns out that flag is ALSO set by the
-- legacy /enableMultiOrg endpoint, so every v1 multi-org user had it = true
-- and got skipped (diagnostic ran in 20260520000006 confirmed 0 matched the
-- old predicate vs 11 matching this one).
--
-- The truly V3-exclusive signal is `onboarding.first_client_org_id IS NOT NULL`
-- — only `completeOnboardingV3` step 3 sets that column.
--
-- Predicate (a v1 multi-org account is):
--   * user owns 2+ organizations total
--   * user owns an org with is_agency = true
--   * that org has business_address NOT NULL (proves it's a real v1 business
--     org, not an empty agency shell; also gives us idempotency — after the
--     migration the NEW agency-manager has business_address = NULL, so a
--     re-run will not double-process)
--   * no org owned by the user has onboarding.first_client_org_id set
--     (no V3 step 3 has happened anywhere for this user)
--
-- For each such user:
--   1. Create a NEW org with is_agency = true (the agency manager).
--   2. PERFORM create_default_app_content for it.
--   3. Insert blank onboarding row for it.
--   4. Flip the old is_agency=true org to is_agency=false (demote to sub-org).
--   5. profiles.active_organization_id = new agency org id.
--      (multi_org_enabled is already true for everyone in scope, so no change there.)

DO $$
DECLARE
  v_user uuid;
  v_old_org_id uuid;
  v_old_business_name text;
  v_new_org_id uuid;
  v_count int := 0;
BEGIN
  FOR v_user, v_old_org_id, v_old_business_name IN
    SELECT o.owner_id, o.id, o.business_name
    FROM organizations o
    WHERE o.is_agency = true
      AND o.business_address IS NOT NULL
      AND (SELECT COUNT(*) FROM organizations WHERE owner_id = o.owner_id) >= 2
      AND NOT EXISTS (
        SELECT 1
        FROM organizations o2
        JOIN onboarding ob ON ob.organization_id = o2.id
        WHERE o2.owner_id = o.owner_id
          AND ob.first_client_org_id IS NOT NULL
      )
  LOOP
    -- 1. Create new agency-manager org. business_address LEFT NULL on purpose:
    --    it's the idempotency signal for re-runs and matches V3's expectation
    --    that the agency parent is a meta-org without its own postal address.
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

    -- 2. Seed app_content rows (one per role). Non-fatal on error.
    BEGIN
      PERFORM create_default_app_content(v_new_org_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'create_default_app_content failed for org %: %', v_new_org_id, SQLERRM;
    END;

    -- 3. Blank onboarding row for the new agency
    INSERT INTO onboarding (organization_id) VALUES (v_new_org_id);

    -- 4. Demote the old v1 agency org
    UPDATE organizations
       SET is_agency = false, updated_at = now()
     WHERE id = v_old_org_id;

    -- 5. Point the user's active org at the new agency manager.
    --    multi_org_enabled is already true for everyone in this cohort
    --    (they all used /enableMultiOrg), so no change there.
    UPDATE profiles
       SET active_organization_id = v_new_org_id,
           updated_at = now()
     WHERE id = v_user;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Migrated % v1 agency account(s) to V3 model', v_count;
END $$;
