/**
 * Assigns template bundles in template_bundle_ids.json to a specific organization.
 *
 * Sets for each bundle:
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
    fs.readFileSync(path.join(__dirname, "template_bundle_ids.json"), "utf8")
  ).map((entry) => entry.id).filter(Boolean);

  if (ids.length === 0) {
    console.error("❌ No IDs found in template_bundles_id.json. Populate the file first.");
    process.exit(1);
  }

  const filter = `id=in.(${ids.join(",")})`;

  // ── Step 1: Fetch and display current bundles ─────────────────────────────
  console.log(`\nFetching ${ids.length} template bundle(s)...\n`);

  const getRes = await fetch(
    `${BASE_URL}/rest/v1/template_bundles?${filter}&select=id,organization_id,is_universal`,
    { headers: HEADERS }
  );

  if (!getRes.ok) {
    const err = await getRes.text();
    console.error(`❌ GET failed: ${getRes.status} - ${err}`);
    process.exit(1);
  }

  const bundles = await getRes.json();
  console.table(
    bundles.map(({ id, organization_id, is_universal }) => ({
      id,
      organization_id,
      is_universal,
    }))
  );
  console.log(`\nFound ${bundles.length} bundle(s). Assigning to org ${ORG_ID} with is_universal = false...`);

  // ── Step 2: Patch bundles ─────────────────────────────────────────────────
  const patchRes = await fetch(`${BASE_URL}/rest/v1/template_bundles?${filter}`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({
      organization_id: ORG_ID,
      is_universal: false,
    }),
  });

  if (!patchRes.ok) {
    const err = await patchRes.text();
    console.error(`❌ PATCH failed: ${patchRes.status} - ${err}`);
    process.exit(1);
  }

  const updated = await patchRes.json();
  console.log(`\n✅ Done — ${updated.length} bundle(s) updated.`);
})();
