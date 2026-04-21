/**
 * Seed script: Insert dummy data for getAnalyticsV2
 *
 * Creates 10 campaigns + postcard_sends + payment_history for the test user,
 * then verifies all 6 analytics types return data.
 *
 * Usage: node supabase/scripts/seed-analytics-v2.js
 */

const DEV_SUPABASE_URL = "https://xnflihspegizweqidvow.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZmxpaHNwZWdpendlcWlkdm93Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MjY0NDIsImV4cCI6MjA4NjUwMjQ0Mn0.7L8OiS4qzDzTSprhXthnnMdWgPltqYopYzYHNUp_6a0";
const SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZmxpaHNwZWdpendlcWlkdm93Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkyNjQ0MiwiZXhwIjoyMDg2NTAyNDQyfQ.aXgRvCDrqSJhlEF-bOoCaATVdBz6ctromOKm8x04FJ0";
const API_BASE_URL = `${DEV_SUPABASE_URL}/functions/v1`;

const USER_EMAIL = "4zatl@deltajohnsons.com";
const USER_PASSWORD = "SecurePass123!";
const PRICE_PER_POSTCARD = 3.0;

// ---------------------------------------------------------------------------
// Campaign definitions — name + how many postcards to generate
// ---------------------------------------------------------------------------
const CAMPAIGN_DEFINITIONS = [
  { name: "Spring Home Services 2026", postcardCount: 50 },
  { name: "Summer Roofing Special", postcardCount: 42 },
  { name: "Fall HVAC Checkup", postcardCount: 65 },
  { name: "Winter Weatherproofing Drive", postcardCount: 38 },
  { name: "New Year Plumbing Offer", postcardCount: 55 },
  { name: "Valentine's Day Flooring", postcardCount: 30 },
  { name: "Easter Window Replacement", postcardCount: 48 },
  { name: "Back-to-School Landscaping", postcardCount: 72 },
  { name: "Labor Day Gutters Special", postcardCount: 25 },
  { name: "Holiday Season Heating", postcardCount: 60 },
];

// Realistic Texas addresses for postcard delivery targets
const SAMPLE_ADDRESSES = [
  "123 Main St, Austin, TX 78701",
  "456 Oak Ave, Dallas, TX 75201",
  "789 Pine Rd, Houston, TX 77001",
  "321 Elm St, San Antonio, TX 78201",
  "654 Maple Dr, Fort Worth, TX 76101",
  "987 Cedar Ln, El Paso, TX 79901",
  "147 Birch Blvd, Arlington, TX 76001",
  "258 Walnut Way, Plano, TX 75023",
  "369 Hickory Ave, Lubbock, TX 79401",
  "741 Spruce St, Garland, TX 75040",
  "852 Peach Blvd, Irving, TX 75060",
  "963 Magnolia Dr, Laredo, TX 78040",
  "159 Cypress St, Amarillo, TX 79101",
  "357 Willow Rd, Grand Prairie, TX 75050",
  "486 Pecan Lane, McKinney, TX 75069",
  "624 Juniper Ave, Mesquite, TX 75149",
  "735 Sycamore Blvd, Killeen, TX 76541",
  "846 Redwood Dr, Frisco, TX 75034",
  "915 Cottonwood St, Pasadena, TX 77501",
  "204 Dogwood Ln, Waco, TX 76701",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serviceHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Prefer: "return=representation",
    ...extra,
  };
}

function userHeaders(accessToken, extra = {}) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
    apikey: SUPABASE_ANON_KEY,
    ...extra,
  };
}

/**
 * Assigns a postgrid_status + imb_status pair using realistic delivery ratios:
 *   55% completed (delivered)
 *   15% processed_for_delivery  → 50% chance of entered_mail_stream / out_for_delivery
 *   12% printing
 *   10% ready
 *    5% cancelled
 *    3% completed but returned_to_sender (USPS returned)
 */
function randomPostcardStatus() {
  const rand = Math.random();
  if (rand < 0.55) return { postgrid_status: "completed", imb_status: null };
  if (rand < 0.70) {
    const imb = Math.random() < 0.5 ? "entered_mail_stream" : "out_for_delivery";
    return { postgrid_status: "processed_for_delivery", imb_status: imb };
  }
  if (rand < 0.82) return { postgrid_status: "printing", imb_status: null };
  if (rand < 0.92) return { postgrid_status: "ready", imb_status: null };
  if (rand < 0.97) return { postgrid_status: "cancelled", imb_status: null };
  // Returned to sender (completed + imb returned)
  return { postgrid_status: "completed", imb_status: "returned_to_sender" };
}

/** Random ISO timestamp within the last `maxDaysAgo` days */
function randomDate(maxDaysAgo = 90) {
  const msAgo = Math.floor(Math.random() * maxDaysAgo * 24 * 60 * 60 * 1000);
  return new Date(Date.now() - msAgo).toISOString();
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function insertRow(table, row) {
  const res = await fetch(`${DEV_SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Insert into ${table} failed (${res.status}): ${err}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data[0] : data;
}

async function insertRows(table, rows) {
  const res = await fetch(`${DEV_SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Bulk insert into ${table} failed (${res.status}): ${err}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Auth + org lookup
// ---------------------------------------------------------------------------

async function signIn() {
  const res = await fetch(
    `${DEV_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: USER_EMAIL, password: USER_PASSWORD }),
    }
  );
  if (!res.ok) throw new Error(`Sign-in failed: ${await res.text()}`);
  const data = await res.json();
  return { userId: data.user.id, accessToken: data.access_token };
}

async function getOrganizationId(userId) {
  const res = await fetch(
    `${DEV_SUPABASE_URL}/rest/v1/organizations?owner_id=eq.${userId}&select=id&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!res.ok) throw new Error(`Org lookup failed: ${await res.text()}`);
  const data = await res.json();
  if (!data.length) throw new Error(`No organization found for user ${userId}`);
  return data[0].id;
}

// ---------------------------------------------------------------------------
// Verify via getAnalyticsV2
// ---------------------------------------------------------------------------

async function testAnalyticsType(type, accessToken, label) {
  const res = await fetch(`${API_BASE_URL}/getAnalyticsV2`, {
    method: "POST",
    headers: userHeaders(accessToken),
    body: JSON.stringify({ type }),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  const ok = res.ok ? "✓" : "✗";
  console.log(`   ${ok} ${label} (${res.status})`);
  if (!res.ok) console.log(`     └─ ${text}`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log("=== Analytics V2 Seed Script ===");
  console.log(`Target: ${DEV_SUPABASE_URL}`);
  console.log(`User:   ${USER_EMAIL}\n`);

  // ── 1. Auth ────────────────────────────────────────────────────────────────
  console.log("Step 1 — Authenticating...");
  const { userId, accessToken } = await signIn();
  console.log(`   User ID: ${userId}\n`);

  // ── 2. Organization ────────────────────────────────────────────────────────
  console.log("Step 2 — Fetching organization...");
  const organizationId = await getOrganizationId(userId);
  console.log(`   Organization ID: ${organizationId}\n`);

  // ── 3. Campaigns ───────────────────────────────────────────────────────────
  console.log("Step 3 — Inserting 10 campaigns...");
  const campaigns = [];

  for (const def of CAMPAIGN_DEFINITIONS) {
    const campaign = await insertRow("campaigns", {
      organization_id: organizationId,
      campaign_name: def.name,
      current_step: 6,
      status: { id: null, name: "Active" },
      postcards_sent: def.postcardCount,
      offer_data: {
        offer_headline: `${def.name} — Limited Offer`,
        offer_description:
          "Exclusive deal for homeowners in your area. Act now!",
        cta_text: "Call Today",
        disclaimer_text: "Offer valid while supplies last.",
      },
      business_data: {
        business_name: "Delta Johnsons Home Services",
        phone: "(512) 555-0100",
        website: "https://deltajohnsons.com",
      },
    });
    campaigns.push({ ...campaign, postcardCount: def.postcardCount });
    console.log(`   ✓ "${def.name}" — id: ${campaign.id}`);
  }

  // ── 4. Postcard Sends ──────────────────────────────────────────────────────
  console.log("\nStep 4 — Inserting postcard_sends...");
  let totalPostcards = 0;

  for (const campaign of campaigns) {
    const sends = [];
    for (let i = 0; i < campaign.postcardCount; i++) {
      const { postgrid_status, imb_status } = randomPostcardStatus();
      sends.push({
        campaign_id: campaign.id,
        organization_id: organizationId,
        // Unique fake PostGrid postcard ID per record
        postgrid_postcard_id: `postcard_seed_${campaign.id.replace(/-/g, "")}_${i}`,
        postgrid_status,
        imb_status,
        address: pick(SAMPLE_ADDRESSES),
        created_at: randomDate(90),
      });
    }
    await insertRows("postcard_sends", sends);
    totalPostcards += sends.length;

    const delivered = sends.filter((s) => s.postgrid_status === "completed").length;
    const cancelled = sends.filter((s) => s.postgrid_status === "cancelled").length;
    const returned = sends.filter((s) => s.imb_status === "returned_to_sender").length;
    console.log(
      `   ✓ "${campaign.campaign_name}" — ${sends.length} postcards ` +
        `(delivered: ${delivered}, cancelled: ${cancelled}, returned: ${returned})`
    );
  }
  console.log(`   Total postcards inserted: ${totalPostcards}`);

  // ── 5. Payment History ─────────────────────────────────────────────────────
  console.log("\nStep 5 — Inserting payment_history...");
  let totalSpent = 0;

  for (const campaign of campaigns) {
    const amount = +(campaign.postcardCount * PRICE_PER_POSTCARD).toFixed(2);
    const shortId = campaign.id.replace(/-/g, "").slice(0, 16);
    await insertRow("payment_history", {
      campaign_id: campaign.id,
      organization_id: organizationId,
      amount_paid: amount,
      currency: "usd",
      stripe_charge_id: `ch_seed_${shortId}`,
      stripe_invoice_id: `in_seed_${shortId}`,
    });
    totalSpent += amount;
    console.log(`   ✓ $${amount.toFixed(2)} — "${campaign.campaign_name}"`);
  }
  console.log(`   Total spend inserted: $${totalSpent.toFixed(2)}`);

  // ── 6. Verify getAnalyticsV2 ───────────────────────────────────────────────
  console.log("\nStep 6 — Verifying getAnalyticsV2 endpoints...");
  await testAnalyticsType("dashboard_cards", accessToken, "dashboard_cards");
  await testAnalyticsType("delivery_funnel", accessToken, "delivery_funnel");
  await testAnalyticsType("waste_meter", accessToken, "waste_meter");
  await testAnalyticsType("scan_trend", accessToken, "scan_trend       (returns 0s — no PostGrid trackers)");
  await testAnalyticsType("recent_scans", accessToken, "recent_scans     (returns [] — no PostGrid trackers)");
  await testAnalyticsType("campaign_leaderboard", accessToken, "campaign_leaderboard (returns [] — no PostGrid trackers)");

  console.log("\n=== Seed complete ===");
  console.log(`Campaigns:  ${campaigns.length}`);
  console.log(`Postcards:  ${totalPostcards}`);
  console.log(`Payments:   ${campaigns.length}`);
  console.log(`Total Spent: $${totalSpent.toFixed(2)}`);
})();
