-- Fix is_agency for sub-orgs created via createOrganization API.
-- When is_agency was added (DEFAULT TRUE), all existing orgs inherited TRUE.
-- Rule: for owners with multiple orgs, only the earliest (primary/signup org)
-- keeps is_agency = TRUE. All later orgs are sub-orgs → is_agency = FALSE.

UPDATE organizations o
SET is_agency = FALSE
WHERE o.is_agency = TRUE
  AND EXISTS (
    SELECT 1
    FROM organizations older
    WHERE older.owner_id = o.owner_id
      AND older.created_at < o.created_at
  );
