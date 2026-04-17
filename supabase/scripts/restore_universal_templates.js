/**
 * Restores templates in universal_template_ids.json to universal status.
 *
 * Sets for each template:
 *   - organization_id → null
 *   - is_universal    → true
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

  console.log(`Restoring ${ids.length} templates to universal (no org)...`);

  const filter = `id=in.(${ids.join(",")})`;
  const url = `${BASE_URL}/rest/v1/templates?${filter}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify({
      organization_id: null,
      is_universal: true,
      is_manual_edit: false,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`❌ PATCH failed: ${res.status} - ${err}`);
    process.exit(1);
  }

  const updated = await res.json();
  console.log(`✅ Done — ${updated.length} template(s) restored to universal.`);
})();
