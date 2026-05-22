-- Diagnostic-only migration. NO DATA CHANGES. Just RAISE NOTICE counts so we
-- can see how many users match each candidate v1 predicate in this DB.
-- Used to validate the predicate for the actual v1→V3 migration.

DO $$
DECLARE
  c1 int; c2 int; c3 int; c4 int; c5 int;
BEGIN
  -- A. Users with at least one is_agency=true org
  SELECT COUNT(DISTINCT owner_id) INTO c1
  FROM organizations
  WHERE is_agency = true;
  RAISE NOTICE 'A. users with >=1 is_agency=true org: %', c1;

  -- B. ... AND 2+ orgs total
  SELECT COUNT(*) INTO c2 FROM (
    SELECT owner_id
    FROM organizations
    GROUP BY owner_id
    HAVING bool_or(is_agency = true)
       AND COUNT(*) >= 2
  ) s;
  RAISE NOTICE 'B. (A) AND user has >=2 orgs total: %', c2;

  -- C. ... AND profiles.multi_org_enabled = false  (the predicate I originally used; turns out this excludes v1 users who used /enableMultiOrg)
  SELECT COUNT(*) INTO c3 FROM (
    SELECT o.owner_id
    FROM organizations o
    JOIN profiles p ON p.id = o.owner_id
    WHERE p.multi_org_enabled = false
    GROUP BY o.owner_id
    HAVING bool_or(o.is_agency = true)
       AND COUNT(*) >= 2
  ) s;
  RAISE NOTICE 'C. (B) AND multi_org_enabled = false (old wrong filter): %', c3;

  -- D. ... AND no onboarding row links a first_client_org_id (the V3-exclusive signal)
  --    Users whose is_agency=true org has onboarding.first_client_org_id NOT NULL
  --    have been through V3 step 3; everyone else is v1 leftover.
  SELECT COUNT(*) INTO c4 FROM (
    SELECT o.owner_id
    FROM organizations o
    WHERE o.is_agency = true
      AND NOT EXISTS (
        SELECT 1 FROM onboarding ob
        WHERE ob.organization_id = o.id
          AND ob.first_client_org_id IS NOT NULL
      )
    GROUP BY o.owner_id
    HAVING COUNT(*) >= 1
       AND (SELECT COUNT(*) FROM organizations WHERE owner_id = o.owner_id) >= 2
  ) s;
  RAISE NOTICE 'D. v1 candidate (no V3 step 3 marker on the is_agency org) AND 2+ orgs: %', c4;

  -- E. ... AND the is_agency=true org has business_address NOT NULL (the
  --    actual "this is a real v1 business org" signal — gives us idempotency
  --    because the new agency-manager we'd create has business_address NULL).
  SELECT COUNT(*) INTO c5 FROM (
    SELECT o.owner_id
    FROM organizations o
    WHERE o.is_agency = true
      AND o.business_address IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM onboarding ob
        WHERE ob.organization_id = o.id
          AND ob.first_client_org_id IS NOT NULL
      )
    GROUP BY o.owner_id
    HAVING COUNT(*) >= 1
       AND (SELECT COUNT(*) FROM organizations WHERE owner_id = o.owner_id) >= 2
  ) s;
  RAISE NOTICE 'E. (D) AND is_agency org has business_address set (final v1 predicate): %', c5;
END $$;
