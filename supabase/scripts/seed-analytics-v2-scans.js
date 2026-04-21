/**
 * Seed script: Add PostGrid trackers + simulated QR scans to existing seed campaigns
 *
 * Run AFTER seed-analytics-v2.js. This script:
 *   1. Finds the 10 seed campaigns for the test user
 *   2. Creates a real PostGrid test tracker for each campaign
 *   3. Links the tracker IDs to the campaigns in the DB
 *   4. Simulates QR scans by visiting the PostGrid PURL endpoint
 *      (https://pgtrack.com/t/{trackerId}/{postcardId}) — PostGrid logs
 *      each hit as a visit regardless of test vs. live key
 *
 * Usage: node supabase/scripts/seed-analytics-v2-scans.js
 */

const DEV_SUPABASE_URL = "https://xnflihspegizweqidvow.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZmxpaHNwZWdpendlcWlkdm93Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MjY0NDIsImV4cCI6MjA4NjUwMjQ0Mn0.7L8OiS4qzDzTSprhXthnnMdWgPltqYopYzYHNUp_6a0";
const SUPABASE_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZmxpaHNwZWdpendlcWlkdm93Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDkyNjQ0MiwiZXhwIjoyMDg2NTAyNDQyfQ.aXgRvCDrqSJhlEF-bOoCaATVdBz6ctromOKm8x04FJ0";
const POSTGRID_API_KEY = "test_sk_7oVoDY45m5aPpjKmMZJxz3";
const POSTGRID_BASE_URL = "https://api.postgrid.com/print-mail/v1";
const POSTGRID_PURL_BASE = "https://pgtrack.com/t";
const API_BASE_URL = `${DEV_SUPABASE_URL}/functions/v1`;

const USER_EMAIL = "4zatl@deltajohnsons.com";
const USER_PASSWORD = "SecurePass123!";

// The campaign names we inserted in seed-analytics-v2.js
const SEED_CAMPAIGN_NAMES = [
  "Spring Home Services 2026",
  "Summer Roofing Special",
  "Fall HVAC Checkup",
  "Winter Weatherproofing Drive",
  "New Year Plumbing Offer",
  "Valentine's Day Flooring",
  "Easter Window Replacement",
  "Back-to-School Landscaping",
  "Labor Day Gutters Special",
  "Holiday Season Heating",
];

// How many simulated scans to generate per campaign (randomised from this range)
const SCAN_MIN = 8;
const SCAN_MAX = 25;

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

/** Fetch seed campaigns for this org by name */
async function fetchSeedCampaigns(organizationId) {
  const nameFilter = SEED_CAMPAIGN_NAMES.map(
    (n) => `campaign_name.eq.${encodeURIComponent(n)}`
  ).join(",");
  const res = await fetch(
    `${DEV_SUPABASE_URL}/rest/v1/campaigns?organization_id=eq.${organizationId}&or=(${nameFilter})&select=id,campaign_name,postgrid_tracker_id&order=created_at.desc`,
    { headers: serviceHeaders() }
  );
  if (!res.ok) throw new Error(`Campaign fetch failed: ${await res.text()}`);
  return res.json();
}

/** Fetch postcard_sends for a campaign — we use their IDs as fake orderId values */
async function fetchPostcardIds(campaignId) {
  const res = await fetch(
    `${DEV_SUPABASE_URL}/rest/v1/postcard_sends?campaign_id=eq.${campaignId}&select=postgrid_postcard_id&limit=30`,
    { headers: serviceHeaders() }
  );
  if (!res.ok) throw new Error(`Postcard fetch failed: ${await res.text()}`);
  const rows = await res.json();
  return rows.map((r) => r.postgrid_postcard_id);
}

/** Create a PostGrid tracker and return its ID */
async function createTracker(campaignName) {
  const res = await fetch(`${POSTGRID_BASE_URL}/trackers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": POSTGRID_API_KEY,
    },
    body: JSON.stringify({
      redirectURLTemplate: "https://deltajohnsons.com",
      urlExpireAfterDays: 365,
    }),
  });
  if (!res.ok) throw new Error(`Tracker creation failed: ${await res.text()}`);
  const data = await res.json();
  return data.id;
}

/** Store the tracker ID on the campaign row */
async function linkTrackerToCampaign(campaignId, trackerId) {
  const res = await fetch(
    `${DEV_SUPABASE_URL}/rest/v1/campaigns?id=eq.${campaignId}`,
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({ postgrid_tracker_id: trackerId }),
    }
  );
  if (!res.ok) throw new Error(`Campaign update failed: ${await res.text()}`);
}

/**
 * Simulate a QR code scan by visiting the PostGrid PURL endpoint.
 * PostGrid logs each GET as a visit (orderId is recorded for per-postcard attribution).
 * Returns true on success.
 */
async function simulateScan(trackerId, orderId) {
  try {
    const url = `${POSTGRID_PURL_BASE}/${trackerId}/${orderId}`;
    // follow=false — we only care that PostGrid logged the visit, not where it redirects
    const res = await fetch(url, { redirect: "manual" });
    // 301/302 means PostGrid accepted the visit; 404 means unknown tracker
    return res.status === 301 || res.status === 302 || res.status === 200;
  } catch {
    return false;
  }
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

async function testAnalytics(type, accessToken, note = "") {
  const res = await fetch(`${API_BASE_URL}/getAnalyticsV2`, {
    method: "POST",
    headers: userHeaders(accessToken),
    body: JSON.stringify({ type }),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  const ok = res.ok ? "✓" : "✗";
  console.log(`   ${ok} ${type}${note ? " — " + note : ""} (${res.status})`);
  if (res.ok && parsed?.data) {
    // Print a brief summary of the returned data
    const d = parsed.data;
    if (type === "dashboard_cards")
      console.log(`      in_flight=${d.in_flight_postcards} delivered=${d.delivered} spent=$${d.spent_to_date}`);
    if (type === "delivery_funnel")
      console.log(`      total=${d.total_postcards_sent} delivered=${d.delivered?.count} cancelled=${d.cancelled?.count}`);
    if (type === "waste_meter")
      console.log(`      status=${d.status} wasted=${d.total_pieces_wasted} delayed=${d.total_pieces_delayed}`);
    if (type === "scan_trend")
      console.log(`      total_scans=${d.total_scans} unique_scans=${d.unique_scans} scan_rate=${d.scan_rate}%`);
    if (type === "recent_scans")
      console.log(`      campaigns_with_scans=${d.data?.length ?? 0}`);
    if (type === "campaign_leaderboard")
      console.log(`      leaderboard_entries=${d.leaderboard?.length ?? 0}`);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  console.log("=== Analytics V2 — Tracker + Scan Seeder ===");
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

  // ── 3. Fetch existing seed campaigns ──────────────────────────────────────
  console.log("Step 3 — Fetching seed campaigns...");
  const campaigns = await fetchSeedCampaigns(organizationId);
  if (!campaigns.length) {
    console.error("   ✗ No seed campaigns found. Run seed-analytics-v2.js first.");
    process.exit(1);
  }
  console.log(`   Found ${campaigns.length} campaigns\n`);

  // ── 4. Create trackers + simulate scans ───────────────────────────────────
  console.log("Step 4 — Creating PostGrid trackers and simulating scans...");
  const results = [];

  for (const campaign of campaigns) {
    // Skip if already has a tracker
    if (campaign.postgrid_tracker_id) {
      console.log(`   ~ "${campaign.campaign_name}" — already has tracker ${campaign.postgrid_tracker_id}, skipping`);
      results.push({ campaign, trackerId: campaign.postgrid_tracker_id, scans: 0 });
      continue;
    }

    // Create tracker
    let trackerId;
    try {
      trackerId = await createTracker(campaign.campaign_name);
    } catch (err) {
      console.error(`   ✗ Tracker creation failed for "${campaign.campaign_name}": ${err.message}`);
      continue;
    }

    // Link to campaign in DB
    await linkTrackerToCampaign(campaign.id, trackerId);
    console.log(`   ✓ "${campaign.campaign_name}" → tracker ${trackerId}`);

    // Fetch postcard IDs to use as orderId in PURL visits
    const postcardIds = await fetchPostcardIds(campaign.id);
    const scanCount = randInt(SCAN_MIN, SCAN_MAX);
    let successfulScans = 0;

    // Simulate scans — reuse postcard IDs to generate unique + repeat visits
    for (let i = 0; i < scanCount; i++) {
      const orderId = postcardIds[i % postcardIds.length] ?? `fake_order_${i}`;
      const ok = await simulateScan(trackerId, orderId);
      if (ok) successfulScans++;
      // Small delay to avoid rate limiting
      await sleep(120);
    }

    console.log(`      Simulated ${successfulScans}/${scanCount} scans`);
    results.push({ campaign, trackerId, scans: successfulScans });
  }

  // ── 5. Brief pause for PostGrid to index visits ───────────────────────────
  console.log("\nStep 5 — Waiting 3s for PostGrid to index visits...");
  await sleep(3000);

  // ── 6. Verify all analytics types ─────────────────────────────────────────
  console.log("\nStep 6 — Verifying getAnalyticsV2 endpoints...\n");
  await testAnalytics("dashboard_cards", accessToken);
  await testAnalytics("delivery_funnel", accessToken);
  await testAnalytics("waste_meter", accessToken);
  await testAnalytics("scan_trend", accessToken);
  await testAnalytics("recent_scans", accessToken);
  await testAnalytics("campaign_leaderboard", accessToken);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("\n=== Scan Seeder Complete ===");
  const withTrackers = results.filter((r) => r.trackerId);
  const totalScans = results.reduce((s, r) => s + r.scans, 0);
  console.log(`Trackers linked: ${withTrackers.length}/${campaigns.length}`);
  console.log(`Total scans simulated: ${totalScans}`);
})();
