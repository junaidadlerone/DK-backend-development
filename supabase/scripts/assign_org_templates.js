/**
 * Assigns templates in universal_template_ids.json to a specific organization.
 *
 * Sets for each template:
 *   - organization_id → "a4f2b7e0-0f01-482c-b936-fd7bf5206a1e"
 *   - is_universal    → false
 *
 * Targets DEV by default. Swap the URL/KEY constants to run against PROD.
 */

const fs = require("fs");
const path = require("path");

// ── Target environment ────────────────────────────────────────────────────────
const BASE_URL = "https://xnflihspegizweqidvow.supabase.co";  // DEV
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZmxpaHNwZWdpendlcWlkdm93Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkyNjQ0MiwiZXhwIjoyMDg2NTAyNDQyfQ.aXgRvCDrqSJhlEF-bOoCaATVdBz6ctromOKm8x04FJ0";  // DEV

// const BASE_URL = "https://iywivotqnphrjijztxtu.supabase.co";  // PROD
// const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5d2l2b3RxbnBocmppanp0eHR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzA1MzUwNSwiZXhwIjoyMDc4NjI5NTA1fQ.-t2aK4MwnVzYNY_48kSlz-Lx85SUqgzOOMr3HPaJs1s";  // PROD

const ORG_ID = "a4f2b7e0-0f01-482c-b936-fd7bf5206a1e";

const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  apikey: SERVICE_ROLE_KEY,
  Prefer: "return=representation",
};

(async () => {
  const ids = JSON.parse(
    fs.readFileSync(path.join(__dirname, "universal_template_ids.json"), "utf8")
  ).map((entry) => entry.id);

  const filter = `id=in.(${ids.join(",")})`;

  // ── Step 1: Fetch and display current templates ───────────────────────────
  console.log(`\nFetching ${ids.length} templates...\n`);

  const getRes = await fetch(
    `${BASE_URL}/rest/v1/templates?${filter}&select=id,name,organization_id,is_universal,is_manual_edit`,
    { headers: HEADERS }
  );

  if (!getRes.ok) {
    const err = await getRes.text();
    console.error(`❌ GET failed: ${getRes.status} - ${err}`);
    process.exit(1);
  }

  const templates = await getRes.json();
  console.table(
    templates.map(({ id, name, organization_id, is_universal, is_manual_edit }) => ({
      id,
      name,
      organization_id,
      is_universal,
      is_manual_edit,
    }))
  );
  console.log(`\nFound ${templates.length} template(s). Proceeding to assign to org ${ORG_ID}...`);

  // ── Step 2: Patch templates ───────────────────────────────────────────────
  const patchRes = await fetch(`${BASE_URL}/rest/v1/templates?${filter}`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({
      organization_id: ORG_ID,
      is_universal: false,
      is_manual_edit: true,
    }),
  });

  if (!patchRes.ok) {
    const err = await patchRes.text();
    console.error(`❌ PATCH failed: ${patchRes.status} - ${err}`);
    process.exit(1);
  }

  const updated = await patchRes.json();
  console.log(`\n✅ Done — ${updated.length} template(s) updated.`);
})();
