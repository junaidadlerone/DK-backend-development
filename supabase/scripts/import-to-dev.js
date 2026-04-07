/**
 * Import templates and template_bundles from PROD JSON exports into DEV.
 * DEV project: xnflihspegizweqidvow — PROD is never touched.
 *
 * Strategy:
 *  1. Insert each template without its PROD id (DEV generates new UUIDs).
 *  2. Build a map: prodId → devId from the returned rows.
 *  3. Insert each bundle without its PROD id, remapping front/back template IDs
 *     to their new DEV counterparts.
 */

const fs = require("fs");
const path = require("path");

const DEV_URL = "https://xnflihspegizweqidvow.supabase.co";
const DEV_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZmxpaHNwZWdpendlcWlkdm93Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkyNjQ0MiwiZXhwIjoyMDg2NTAyNDQyfQ.aXgRvCDrqSJhlEF-bOoCaATVdBz6ctromOKm8x04FJ0";

function headers(extra = {}) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${DEV_SERVICE_ROLE_KEY}`,
    apikey: DEV_SERVICE_ROLE_KEY,
    Prefer: "return=representation",
    ...extra,
  };
}

async function insertRow(table, row, onConflict = null) {
  const url = onConflict
    ? `${DEV_URL}/rest/v1/${table}?on_conflict=${onConflict}`
    : `${DEV_URL}/rest/v1/${table}`;

  const preferHeader = onConflict
    ? "return=representation,resolution=merge-duplicates"
    : "return=representation";

  const res = await fetch(url, {
    method: "POST",
    headers: headers({ Prefer: preferHeader }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Insert into ${table} failed: ${res.status} - ${err}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

(async () => {
  const scriptsDir = __dirname;
  const templates = JSON.parse(
    fs.readFileSync(path.join(scriptsDir, "imports.json"), "utf8")
  );
  const bundles = JSON.parse(
    fs.readFileSync(path.join(scriptsDir, "imports2.json"), "utf8")
  );

  // ── Step 1: Insert templates, build prodId → devId map ──────────────────
  console.log(`\n--- Inserting ${templates.length} templates ---`);
  const idMap = {}; // prodId → devId

  for (let i = 0; i < templates.length; i++) {
    const { id: prodId, ...row } = templates[i]; // strip PROD id
    row.organization_id = null; // PROD org IDs don't exist in DEV
    row.is_universal = true;    // required by check_universal_template constraint
    try {
      const inserted = await insertRow("templates", row, "postgrid_template_id");
      idMap[prodId] = inserted.id;
      console.log(`  [${i + 1}/${templates.length}] ${prodId} → ${inserted.id}`);
    } catch (err) {
      console.error(`  ✗ Template ${prodId}: ${err.message}`);
      process.exit(1);
    }
  }
  console.log(`✓ Templates done — ${Object.keys(idMap).length} inserted`);

  // ── Step 2: Insert bundles with remapped template IDs ───────────────────
  console.log(`\n--- Inserting ${bundles.length} template_bundles ---`);
  let bundlesOk = 0;

  for (let i = 0; i < bundles.length; i++) {
    const { id: _prodId, template_front_id, template_back_id, ...rest } = bundles[i];

    const devFrontId = idMap[template_front_id];
    const devBackId = idMap[template_back_id];

    // If not in idMap, check if the template already exists in DEV with that same id
    if (!devFrontId) {
      const r = await fetch(`${DEV_URL}/rest/v1/templates?id=eq.${template_front_id}&select=id`, { headers: headers() });
      const rows = await r.json();
      if (rows.length) idMap[template_front_id] = rows[0].id;
    }
    if (!devBackId) {
      const r = await fetch(`${DEV_URL}/rest/v1/templates?id=eq.${template_back_id}&select=id`, { headers: headers() });
      const rows = await r.json();
      if (rows.length) idMap[template_back_id] = rows[0].id;
    }

    const resolvedFrontId = idMap[template_front_id];
    const resolvedBackId = idMap[template_back_id];

    if (!resolvedFrontId || !resolvedBackId) {
      console.error(
        `  ✗ Bundle ${_prodId}: template not found in DEV — front=${template_front_id} back=${template_back_id}`
      );
      process.exit(1);
    }

    const row = {
      ...rest,
      template_front_id: resolvedFrontId,
      template_back_id: resolvedBackId,
    };

    try {
      const inserted = await insertRow("template_bundles", row);
      bundlesOk++;
      console.log(`  [${i + 1}/${bundles.length}] bundle inserted → ${inserted.id}`);
    } catch (err) {
      console.error(`  ✗ Bundle ${_prodId}: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`✓ template_bundles done — ${bundlesOk} inserted`);
  console.log("\n✅ Import complete.");
})();
