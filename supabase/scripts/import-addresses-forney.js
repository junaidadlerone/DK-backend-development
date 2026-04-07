/**
 * Import addresses from addresses_list.txt into PROD location_zone
 * Zone ID: 6ba9d324-73c1-4dc1-a8d0-a14a105397b6 (CleanAirEpoxy Addresses)
 * Campaign: 967d5209-dc2e-492f-abf1-fc46b08b2175
 *
 * ⚠️  PROD only — replaces existing addresses in this zone, no other data touched.
 */

const fs = require("fs");
const path = require("path");

const PROD_URL = "https://iywivotqnphrjijztxtu.supabase.co";
const PROD_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5d2l2b3RxbnBocmppanp0eHR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzA1MzUwNSwiZXhwIjoyMDc4NjI5NTA1fQ.-t2aK4MwnVzYNY_48kSlz-Lx85SUqgzOOMr3HPaJs1s";
const ZONE_ID = "6ba9d324-73c1-4dc1-a8d0-a14a105397b6";
const GOOGLE_API_KEY = "AIzaSyBJqgwpAdKlQG706WGtz-gOHfI7pC54xzg";

const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${PROD_SERVICE_ROLE_KEY}`,
  apikey: PROD_SERVICE_ROLE_KEY,
};

const CREATED_BY = {
  id: "a0f6909f-1a1d-4a90-8eaf-abcf4a705c32",
  full_name: "TGF Team",
  user_role: "ADMIN",
  created_at: "2026-03-25T16:05:54.19772+00:00",
  updated_at: "2026-03-25T16:09:11.402982+00:00",
};
const ZONE_TYPE = "radius";
const TARGETING_ZONE_NAME = "CleanAirEpoxy Addresses";

async function geocode(addressStr) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressStr)}&key=${GOOGLE_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === "OK" && data.results.length > 0) {
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, long: loc.lng };
  }
  console.warn(`  ⚠️  Could not geocode: ${addressStr} (status: ${data.status})`);
  return { lat: 0, long: 0 };
}

// Parse "10022 Greyson Dr, Forney, TX 75126" → { line1, city, state, zip }
function parseAddressStr(addressStr) {
  const parts = addressStr.split(",").map((p) => p.trim());
  const line1 = parts[0] || "";
  const city = parts[1] || "";
  const stateZip = (parts[2] || "").trim().split(" ");
  const state = stateZip[0] || "";
  const zip = stateZip.slice(1).join(" ") || "";
  return { line1, city, state, zip };
}

function buildAddress(addressStr, coords) {
  const { line1, city, state, zip } = parseAddressStr(addressStr);

  return {
    lat: coords.lat,
    long: coords.long,
    osm_id: null,
    address: addressStr,
    original_address: addressStr,
    verified: true,
    status: "Valid",
    verification_details: {
      status: "verified",
      line1,
      city,
      provinceOrState: state,
      postalOrZip: zip,
      details: {},
    },
    residential: true,
    building_type: null,
    propertyType: "Single Family Home",
    postcards_sent: 0,
    campaigns_used_in: [],
    distanceFromCenter: 0,
    targeting_zone_name: TARGETING_ZONE_NAME,
    zoneType: ZONE_TYPE,
    createdBy: CREATED_BY,
    first_post_card_sent_date: null,
  };
}

(async () => {
  const txtPath = path.join(__dirname, "addresses_list.txt");
  const lines = fs.readFileSync(txtPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  console.log(`Parsed ${lines.length} addresses from txt`);

  console.log("\nGeocoding addresses via Google Maps...");
  const addresses = [];
  for (let i = 0; i < lines.length; i++) {
    const addressStr = lines[i];
    const coords = await geocode(addressStr);
    console.log(`  [${i + 1}/${lines.length}] ${addressStr} → lat:${coords.lat}, long:${coords.long}`);
    addresses.push(buildAddress(addressStr, coords));
  }

  console.log(`\nSample address object:`);
  console.log(JSON.stringify(addresses[0], null, 2));

  console.log(`\nPatching zone ${ZONE_ID} on PROD with ${addresses.length} verified addresses...`);

  const res = await fetch(
    `${PROD_URL}/rest/v1/location_zones?id=eq.${ZONE_ID}`,
    {
      method: "PATCH",
      headers: HEADERS,
      body: JSON.stringify({
        addresses,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error(`❌ PATCH failed: ${res.status} - ${err}`);
    process.exit(1);
  }

  console.log(`✅ Done — zone ${ZONE_ID} updated with ${addresses.length} verified addresses.`);
})();
