/**
 * Replace addresses in PROD location_zone 9994ee11-01a7-444e-9d4a-30f939cd96b1
 * with addresses from "TGF Addresses.csv", all marked as verified.
 *
 * ⚠️  PROD only — touches no other table or zone.
 */

const fs = require("fs");
const path = require("path");

const PROD_URL = "https://iywivotqnphrjijztxtu.supabase.co";
const PROD_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml5d2l2b3RxbnBocmppanp0eHR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzA1MzUwNSwiZXhwIjoyMDc4NjI5NTA1fQ.-t2aK4MwnVzYNY_48kSlz-Lx85SUqgzOOMr3HPaJs1s";
const ZONE_ID = "9994ee11-01a7-444e-9d4a-30f939cd96b1";

const HEADERS = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${PROD_SERVICE_ROLE_KEY}`,
  apikey: PROD_SERVICE_ROLE_KEY,
  Prefer: "return=representation",
};

// Zone metadata copied from existing addresses
const CREATED_BY = {
  id: "a0f6909f-1a1d-4a90-8eaf-abcf4a705c32",
  full_name: "TGF Team",
  user_role: "ADMIN",
  created_at: "2026-03-25T16:05:54.19772+00:00",
  updated_at: "2026-03-25T16:09:11.402982+00:00",
};
const ZONE_TYPE = "radius(0.3km)";
const TARGETING_ZONE_NAME = "Zone at 43.4702, -80.5452";
const GOOGLE_API_KEY = "AIzaSyBJqgwpAdKlQG706WGtz-gOHfI7pC54xzg";

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

function parseCSV(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    // Handle quoted fields
    const values = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === "," && !inQuotes) { values.push(current.trim()); current = ""; }
      else { current += char; }
    }
    values.push(current.trim());
    return Object.fromEntries(headers.map((h, i) => [h, values[i] || ""]));
  });
}

function buildAddress(row, coords) {
  // Construct address string matching PostGrid verified format: "Line1, City, State Zip"
  const line1 = row.Address.trim();
  const city = row.City.trim();
  const state = row.State.trim();
  const zip = row.Zip.trim();

  const addressStr = `${line1}, ${city}, ${state} ${zip}`;

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
  const csvPath = path.join(__dirname, "TGF Addresses.csv");
  const rows = parseCSV(csvPath);
  console.log(`Parsed ${rows.length} addresses from CSV`);

  console.log("\nGeocoding addresses via Google Maps...");
  const addresses = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const addressStr = `${row.Address.trim()}, ${row.City.trim()}, ${row.State.trim()} ${row.Zip.trim()}`;
    const coords = await geocode(addressStr);
    console.log(`  [${i + 1}/${rows.length}] ${addressStr} → lat:${coords.lat}, long:${coords.long}`);
    addresses.push(buildAddress(row, coords));
  }

  // Preview first address
  console.log("\nSample address object:");
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

  const result = await res.json();
  console.log(`✅ Done — zone updated. Returned:`, JSON.stringify(result));
})();
