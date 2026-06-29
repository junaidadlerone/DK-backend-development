import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import http from 'http';

const PORT = process.env.PORT || 8080;
const SUPABASE_URL = 'https://xnflihspegizweqidvow.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OSM_NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const USER_AGENT_BASE = 'DoorKnockerApp';
const getRandomUserAgent = () => `${USER_AGENT_BASE}/1.0-${Math.floor(Math.random() * 90000) + 10000}`;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Rentcast — sole property source for this socket
const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY;
const RENTCAST_BASE_URL = 'https://api.rentcast.io/v1';
const METERS_PER_MILE = 1609.344;

// Hard cap on addresses produced per discovery session. Protects the
// downstream postcardsendingsocket from queuing more sends than a single
// WebSocket session can drain. Applied to BOTH modes:
//   - count mode: clamps `data.count` to MAX before the search
//   - radius mode: slices the post-search result set to MAX
const MAX_ADDRESSES_PER_SEARCH = 500;
const RENTCAST_RESIDENTIAL_TYPES = new Set([
    'Single Family', 'Condo', 'Townhouse', 'Manufactured', 'Multi-Family', 'Apartment'
]);

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 32000;

// ==================== UTILITY FUNCTIONS ====================

function getUserFromToken(authToken)
{
    try
    {
        const payload = JSON.parse(Buffer.from(authToken.split('.')[1], 'base64').toString());

        const userId = payload.sub;
        const userMetadata = payload.user_metadata || {};
        const email = payload.email || '';
        const fullName = userMetadata.full_name || userMetadata.fullName || email || 'Unknown User';

        return { userId, userName: fullName, email };
    } catch (error)
    {
        console.error('Error decoding JWT token:', error);
        return null;
    }
}

function sleep(ms)
{
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRetryDelay(attempt)
{
    const delay = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt), MAX_RETRY_DELAY);
    const jitter = delay * (0.75 + Math.random() * 0.5);
    return Math.floor(jitter);
}

async function retryWithBackoff(fn, ws, operationName)
{
    let lastError;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++)
    {
        try
        {
            if (attempt > 0)
            {
                const delay = getRetryDelay(attempt - 1);
                ws.send(JSON.stringify({
                    type: 'retry',
                    message: `Retrying ${operationName} (attempt ${attempt + 1}/${MAX_RETRIES})...`,
                    delay: delay
                }));
                await sleep(delay);
            }

            return await fn();
        } catch (error)
        {
            lastError = error;

            if (error.status >= 400 && error.status < 500 && error.status !== 429)
            {
                throw error;
            }

            if (attempt === MAX_RETRIES - 1)
            {
                break;
            }

            ws.send(JSON.stringify({
                type: 'warning',
                message: `${operationName} failed: ${error.message}. Retrying...`
            }));
        }
    }

    throw new Error(`${operationName} failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
}

async function parseAddress(addressInput, ws)
{
    ws.send(JSON.stringify({
        type: 'progress',
        message: 'Parsing address...'
    }));

    const latLngMatch = addressInput.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (latLngMatch)
    {
        const lat = parseFloat(latLngMatch[1]);
        const lng = parseFloat(latLngMatch[2]);

        if (lat < -90 || lat > 90 || lng < -180 || lng > 180)
        {
            throw new Error('Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.');
        }

        return { lat, lng };
    }

    ws.send(JSON.stringify({
        type: 'progress',
        message: 'Geocoding address...'
    }));

    // Try Google Maps first — far more comprehensive for US addresses and new developments
    if (GOOGLE_MAPS_API_KEY)
    {
        try
        {
            const googleResp = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressInput)}&key=${GOOGLE_MAPS_API_KEY}`
            );
            if (googleResp.ok)
            {
                const googleData = await googleResp.json();
                if (googleData.status === 'OK' && googleData.results?.length > 0)
                {
                    const loc = googleData.results[0].geometry.location;
                    return { lat: loc.lat, lng: loc.lng };
                }
            }
        } catch (googleError)
        {
            console.warn('Google Maps geocoding failed, falling back to Nominatim:', googleError.message);
        }
    }

    // Fallback: Nominatim (OSM)
    const geocode = async () =>
    {
        const response = await fetch(
            `${OSM_NOMINATIM_URL}/search?format=json&q=${encodeURIComponent(addressInput)}&limit=1`,
            { headers: { 'User-Agent': getRandomUserAgent() } }
        );

        if (!response.ok)
        {
            const error = new Error(`Nominatim API error: ${response.statusText}`);
            error.status = response.status;
            throw error;
        }

        const data = await response.json();
        if (!data || data.length === 0)
        {
            throw new Error('Address not found. Please provide a valid address or lat,lng coordinates.');
        }

        return {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon)
        };
    };

    return await retryWithBackoff(geocode, ws, 'Address geocoding');
}

// ==================== RENTCAST (PRIMARY) ====================

// =============================================================================
// PROPERTY-TYPE TAXONOMY (mirrors getPropertyCategories edge function)
// =============================================================================
// Frontend picks subcategories from the /getPropertyCategories endpoint and
// echoes the ids here as `subcategory_ids`. We map them back to RentCast's
// `propertyType` enum locally to avoid a round-trip on every search.
const SUBCATEGORY_TO_RENTCAST = new Map([
    ['single_family', 'Single Family'],
    ['condo',         'Condo'],
    ['townhouse',     'Townhouse'],
    ['multi_family',  'Multi-Family'],
    ['apartment',     'Apartment'],
    ['manufactured',  'Manufactured'],
    ['industrial',    'Industrial'],
    ['commercial',    'Commercial'],
    ['retail',        'Retail'],
    ['office',        'Office'],
    ['land',          'Land'],
]);

function subcategoryIdsToRentcastTypes(subcategoryIds)
{
    if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) return null; // null → no filter
    const out = new Set();
    for (const id of subcategoryIds)
    {
        const t = SUBCATEGORY_TO_RENTCAST.get(id);
        if (t) out.add(t);
    }
    return out.size > 0 ? out : null;
}

// =============================================================================
// POLYGON GEOMETRY HELPERS
// =============================================================================
function pointInPolygon(lat, lng, polygon)
{
    // Ray-casting. polygon = array of {lat, lng}. Closed ring (last point may
    // equal the first; either is fine — the algorithm wraps with `j = i-1`).
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++)
    {
        const xi = polygon[i].lng, yi = polygon[i].lat;
        const xj = polygon[j].lng, yj = polygon[j].lat;
        const intersect = ((yi > lat) !== (yj > lat))
            && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function polygonCentroid(polygon)
{
    let lat = 0, lng = 0;
    for (const p of polygon) { lat += p.lat; lng += p.lng; }
    return { lat: lat / polygon.length, lng: lng / polygon.length };
}

function polygonBoundingRadiusMeters(polygon, centroid)
{
    let max = 0;
    for (const p of polygon)
    {
        const d = calculateDistance(centroid.lat, centroid.lng, p.lat, p.lng);
        if (d > max) max = d;
    }
    return max;
}

// =============================================================================
// RENTCAST (PRIMARY)
// =============================================================================
async function fetchRentcastProperties(center, data, ws)
{
    const { radius, count, searchType = 'ALL', subcategory_ids, polygon, mode } = data;
    const isPolygonMode = mode === 'polygon' && Array.isArray(polygon) && polygon.length >= 3;
    const isCountMode = !isPolygonMode && !!(count && !radius);
    const PAGE_SIZE = 500;

    // Subcategory filter (preferred). Falls back to the legacy `searchType`
    // axis (RESIDENTIAL / OTHER / ALL) when subcategory_ids is absent so the
    // old findaddresses-shape requests still work via this socket.
    const allowedRentcastTypes = subcategoryIdsToRentcastTypes(subcategory_ids);
    const applyFilter = (properties) =>
    {
        if (allowedRentcastTypes) return properties.filter(p => allowedRentcastTypes.has(p.propertyType));
        if (searchType === 'RESIDENTIAL') return properties.filter(p => RENTCAST_RESIDENTIAL_TYPES.has(p.propertyType));
        if (searchType === 'OTHER') return properties.filter(p => !RENTCAST_RESIDENTIAL_TYPES.has(p.propertyType));
        return properties;
    };

    // Paginate Rentcast up to maxResults for a given radius
    const fetchPage = async (radiusMiles, maxResults) =>
    {
        let allProperties = [];
        let offset = 0;
        let totalCount = null;

        while (allProperties.length < maxResults)
        {
            const params = new URLSearchParams({
                latitude: center.lat.toFixed(6),
                longitude: center.lng.toFixed(6),
                radius: radiusMiles.toFixed(2),
                limit: PAGE_SIZE,
                offset,
                includeTotalCount: 'true'
            });

            const response = await fetch(`${RENTCAST_BASE_URL}/properties?${params}`, {
                headers: { 'X-Api-Key': RENTCAST_API_KEY }
            });

            if (!response.ok)
            {
                const body = await response.text();
                const err = new Error(`Rentcast API ${response.status}: ${body || response.statusText}`);
                err.status = response.status;
                throw err;
            }

            if (totalCount === null)
            {
                const hdr = response.headers.get('X-Total-Count');
                totalCount = hdr ? parseInt(hdr, 10) : null;
            }

            const page = await response.json();
            if (!Array.isArray(page) || page.length === 0) break;

            allProperties = allProperties.concat(page);
            offset += PAGE_SIZE;
            if (page.length < PAGE_SIZE) break;
        }

        return { allProperties, totalCount };
    };

    const annotateAndSort = (properties) =>
        properties
            .map(p => ({ ...p, _dist: calculateDistance(center.lat, center.lng, p.latitude, p.longitude) }))
            .sort((a, b) => a._dist - b._dist);

    if (isPolygonMode)
    {
        // Polygon mode: RentCast doesn't take a polygon — fetch a bounding-
        // circle around the centroid then point-in-polygon filter post-fetch.
        const centroid = polygonCentroid(polygon);
        const bboxRadiusMeters = polygonBoundingRadiusMeters(polygon, centroid);
        const radiusMiles = Math.min(100, bboxRadiusMeters / METERS_PER_MILE);
        ws.send(JSON.stringify({
            type: 'progress',
            message: `Searching polygon (bbox radius ${radiusMiles.toFixed(2)} miles around centroid)...`
        }));

        const { allProperties, totalCount } = await fetchPage(radiusMiles, 2000);
        const inside = allProperties.filter(p =>
            typeof p.latitude === 'number' && typeof p.longitude === 'number' &&
            pointInPolygon(p.latitude, p.longitude, polygon)
        );
        const filtered = annotateAndSort(applyFilter(inside));

        return {
            properties: filtered,
            totalFound: totalCount !== null ? totalCount : allProperties.length,
            mode: 'polygon',
            searchRadius: Math.round(bboxRadiusMeters)
        };
    }

    if (!isCountMode)
    {
        // Radius mode: fixed radius, return everything within it
        const radiusMiles = Math.min(100, radius / METERS_PER_MILE);
        ws.send(JSON.stringify({ type: 'progress', message: `Searching for properties within ${radiusMiles.toFixed(2)} miles...` }));

        const { allProperties, totalCount } = await fetchPage(radiusMiles, 2000);
        const filtered = annotateAndSort(applyFilter(allProperties));

        return {
            properties: filtered,
            totalFound: totalCount !== null ? totalCount : allProperties.length,
            mode: 'radius',
            searchRadius: radius
        };
    }

    // Count mode: start with a tight 0.1-mile radius and expand outward until we
    // have at least `count` properties, then return the N closest.
    // This mirrors radius mode behaviour — addresses hug the center point.
    ws.send(JSON.stringify({ type: 'progress', message: `Searching for ${count} nearby properties...` }));

    let radiusMiles = 0.1;
    // Per product decision: count/budget mode is NOT bounded by a fixed radius
    // ceiling — it keeps expanding outward until it gathers `count` properties
    // (already clamped to the 500 send-capacity cap) or the area is exhausted.
    // Termination is driven by the target, a saturation check, and a hard
    // expansion backstop — never by a mileage limit.
    const MAX_EXPANSIONS = 15;   // runaway backstop: guarantees the loop ends
    let best = { properties: [], totalCount: null };
    let prevTotalCount = null;

    for (let expansion = 0; expansion < MAX_EXPANSIONS; expansion++)
    {
        const { allProperties, totalCount } = await fetchPage(radiusMiles, count * 2);
        const filtered = annotateAndSort(applyFilter(allProperties));
        best = { properties: filtered, totalCount };

        // Target reached — return the N closest.
        if (filtered.length >= count) break;
        // Saturation guard: a larger radius revealed no additional properties
        // (RentCast's total — requested via includeTotalCount — is unchanged),
        // so the area is exhausted. Also terminates remote / zero-coverage
        // regions (e.g. Alaska wilderness) within a couple of iterations.
        if (totalCount !== null && totalCount === prevTotalCount) break;
        prevTotalCount = totalCount;

        // Estimate the radius needed using observed density; enforce minimum 1.5× growth.
        // No upper clamp — the radius grows freely until one of the breaks above fires.
        if (filtered.length > 0)
        {
            const density = filtered.length / (Math.PI * radiusMiles * radiusMiles);
            const needed = Math.sqrt(count / (Math.PI * density)) * 1.1;
            radiusMiles = Math.max(radiusMiles * 1.5, needed);
        } else
        {
            radiusMiles *= 2;
        }
    }

    return {
        properties: best.properties.slice(0, count),
        totalFound: best.totalCount !== null ? best.totalCount : best.properties.length,
        mode: 'count',
        searchRadius: Math.round(radiusMiles * METERS_PER_MILE)
    };
}

function convertRentcastToAddress(property, center, createdBy, zoneName, zoneTypeStr)
{
    const isResidential = RENTCAST_RESIDENTIAL_TYPES.has(property.propertyType);
    const address = property.formattedAddress ||
        [property.addressLine1, property.city, property.state, property.zipCode]
            .filter(Boolean).join(', ');

    return {
        lat: property.latitude,
        long: property.longitude,
        address,
        residential: isResidential,
        building_type: property.propertyType || 'Unknown',
        propertyType: property.propertyType || 'Unknown',
        distanceFromCenter: property._dist ?? calculateDistance(center.lat, center.lng, property.latitude, property.longitude),
        targeting_zone_name: zoneName || 'Unnamed Zone',
        campaigns_used_in: [],
        zoneType: zoneTypeStr || 'radius',
        postcards_sent: 0,
        first_post_card_sent_date: null,
        status: 'Unverified',
        createdBy: createdBy || {
            id: null,
            user_role: 'TECHNICIAN',
            full_name: 'System',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }
    };
}

// ==================== TEST MODE ====================
// When the WebSocket request payload carries `isTestMode: true`, skip RentCast
// and OSM entirely and synthesise canned property results around the geocoded
// center. The shape mirrors what RentCast would return so downstream
// `convertRentcastToAddress`, save-to-DB, and notification code paths run
// identically. Useful when:
//   - the dev RentCast key is a sandbox/trial key that only returns SF data
//   - QA wants deterministic addresses without burning RentCast quota
//   - the frontend is being tested in isolation
//
// Honors `searchType` (ALL / RESIDENTIAL / OTHER) and respects `count` or
// `radius` from the same payload schema as the real path.
function buildTestProperties(center, data)
{
    const { radius, count, searchType = 'ALL' } = data;
    const radiusMeters = radius || 1000;
    const targetCount = count || 12;
    const max = Math.min(Math.max(targetCount, 5), 25);

    const samples = [
        { street: 'Main St', type: 'Single Family' },
        { street: 'Oak Ave', type: 'Single Family' },
        { street: 'Elm Dr', type: 'Townhouse' },
        { street: 'Cedar Ln', type: 'Condo' },
        { street: 'Maple Ct', type: 'Single Family' },
        { street: 'Pine Pl', type: 'Multi-Family' },
        { street: 'Willow Way', type: 'Apartment' },
        { street: 'Birch Blvd', type: 'Single Family' },
        { street: 'Spruce St', type: 'Condo' },
        { street: 'Aspen Cir', type: 'Single Family' },
        { street: 'Industrial Pkwy', type: 'Industrial' },
        { street: 'Commerce Way', type: 'Commercial' },
        { street: 'Market St', type: 'Retail' },
    ];

    const METERS_PER_DEG_LAT = 111139;
    const props = [];
    for (let i = 0; i < max * 2 && props.length < max; i++)
    {
        const tpl = samples[i % samples.length];
        const propertyType = tpl.type;
        const isResidential = RENTCAST_RESIDENTIAL_TYPES.has(propertyType);
        if (searchType === 'RESIDENTIAL' && !isResidential) continue;
        if (searchType === 'OTHER' && isResidential) continue;

        const houseNum = 100 + ((i * 47) % 9900);
        // Golden-angle spread keeps points well-distributed inside the radius.
        const angle = (i * 137.508) * (Math.PI / 180);
        const r = radiusMeters * Math.sqrt((i + 1) / max);
        const dLat = (r * Math.cos(angle)) / METERS_PER_DEG_LAT;
        const dLng = (r * Math.sin(angle)) / (METERS_PER_DEG_LAT * Math.cos(center.lat * Math.PI / 180));
        const lat = center.lat + dLat;
        const lng = center.lng + dLng;

        props.push({
            id: `test_${i}`,
            addressLine1: `${houseNum} ${tpl.street}`,
            city: 'Testville',
            state: 'TX',
            zipCode: '00000',
            formattedAddress: `${houseNum} ${tpl.street}, Testville, TX 00000`,
            latitude: lat,
            longitude: lng,
            propertyType,
            _dist: Math.round(r),
        });
    }

    return props;
}

// ==================== OPENSTREETMAP (FALLBACK) ====================

function calculateDistance(lat1, lon1, lat2, lon2)
{
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(R * c);
}

async function saveZoneToSupabase(zoneData, ws)
{
    ws.send(JSON.stringify({
        type: 'progress',
        message: 'Saving zone to database...'
    }));

    const saveZone = async () =>
    {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/location_zones`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(zoneData)
        });

        if (!response.ok)
        {
            const errorText = await response.text();
            console.error('Failed to save zone:', response.status, response.statusText);
            console.error('Zone save error response:', errorText);
            const error = new Error(`Failed to save zone: ${response.statusText} - ${errorText}`);
            error.status = response.status;
            throw error;
        }

        const result = await response.json();
        console.log('Successfully saved zone:', result[0]?.id);
        return result[0];
    };

    return await retryWithBackoff(saveZone, ws, 'Database save');
}


// =============================================================================
// DISCOVERY + CURATION (state machine)
// =============================================================================
// Per-session state lives on `ws.discoveryState`:
//   { candidates: [...], byId: Map<id, address>, excluded: Set<id>,
//     center, mode, searchRadius, polygon, totalFound,
//     residentialCount, otherCount, processingTimeMs,
//     zoneName, zoneTypeStr, organizationId, createdByInfo, campaign_id,
//     address (original input or null), searchData, subcategory_ids }
//
// Lifecycle:
//   1. client → { cmd: "search", ... }
//   2. server runs runDiscoverySearch, stores state on ws, emits `candidates` event
//   3. client → { cmd: "exclude" | "include" | "exclude_many" | "include_many", ... }
//   4. server toggles excluded set, emits `curation_update` event
//   5. client → { cmd: "finalize", zone_name? }
//   6. server runs finalizeZone, emits `complete` event with zone_id, drops state
//   7. client → { cmd: "cancel" } or socket close → drop state, no save

const PER_POSTCARD_USD = 3;   // budget mode: floor(budget_usd / PER_POSTCARD_USD)

async function resolveOrganization(authToken, ws)
{
    // Mirrors the org-resolution logic in findaddresses. Returns
    // { organizationId, createdByInfo } or both nulls if anything fails.
    const userFromToken = getUserFromToken(authToken);
    if (!userFromToken) {
        console.error('Failed to decode user from JWT token');
        return { organizationId: null, createdByInfo: null };
    }

    let organizationId = null;
    let createdByInfo = null;

    try
    {
        const profileResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userFromToken.userId}&select=id,role,full_name,created_at,updated_at,active_organization_id`,
            { headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
        );
        if (!profileResponse.ok) return { organizationId: null, createdByInfo: null };
        const profiles = await profileResponse.json();
        if (!profiles || profiles.length === 0) {
            createdByInfo = {
                id: userFromToken.userId,
                user_role: 'TECHNICIAN',
                full_name: userFromToken.userName,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            return { organizationId: null, createdByInfo };
        }
        const profile = profiles[0];
        createdByInfo = {
            id: profile.id,
            user_role: profile.role,
            full_name: profile.full_name || userFromToken.userName,
            created_at: profile.created_at,
            updated_at: profile.updated_at
        };

        const verifyMembership = async (orgId, userId) => {
            const resp = await fetch(
                `${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}&select=id,owner_id,organization_members`,
                { headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
            );
            if (!resp.ok) return false;
            const orgs = await resp.json();
            if (!orgs || orgs.length === 0) return false;
            const org = orgs[0];
            if (org.owner_id === userId) return true;
            const members = org.organization_members || [];
            return Array.isArray(members) && members.some(m => m && m.member_uid === userId);
        };

        if (profile.active_organization_id) {
            const isValid = await verifyMembership(profile.active_organization_id, userFromToken.userId);
            if (isValid) organizationId = profile.active_organization_id;
        }
        if (!organizationId) {
            const allOrgsResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/organizations?select=id,owner_id,organization_members`,
                { headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
            );
            if (allOrgsResponse.ok) {
                const allOrgs = await allOrgsResponse.json();
                for (const org of allOrgs) {
                    if (org.owner_id === userFromToken.userId) { organizationId = org.id; break; }
                    const members = org.organization_members || [];
                    if (Array.isArray(members) && members.some(m => m && m.member_uid === userFromToken.userId)) {
                        organizationId = org.id;
                        break;
                    }
                }
            }
            if (organizationId) {
                try {
                    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userFromToken.userId}`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': SUPABASE_SERVICE_ROLE_KEY,
                            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                        },
                        body: JSON.stringify({ active_organization_id: organizationId })
                    });
                } catch (patchError) {
                    console.error('Error updating profile active_organization_id:', patchError);
                }
            }
        }
    } catch (e) {
        console.error('resolveOrganization error:', e);
    }

    return { organizationId, createdByInfo };
}

async function runDiscoverySearch(ws, message)
{
    const startTime = Date.now();
    const { address, data = {}, campaign_id, headers = {} } = message;

    // ── Mode resolution ──────────────────────────────────────────────────
    const requestedMode = data.mode
        || (Array.isArray(data.polygon) && data.polygon.length >= 3 ? 'polygon'
            : data.budget_usd ? 'budget'
            : data.count ? 'count'
            : 'radius');
    const isPolygonMode = requestedMode === 'polygon';
    const isBudgetMode  = requestedMode === 'budget';
    const isCountMode   = requestedMode === 'count';
    const isRadiusMode  = requestedMode === 'radius';

    // ── Validation ───────────────────────────────────────────────────────
    if (isPolygonMode) {
        if (!Array.isArray(data.polygon) || data.polygon.length < 3) {
            throw new Error('Polygon mode requires data.polygon with at least 3 vertices');
        }
        for (const p of data.polygon) {
            if (typeof p?.lat !== 'number' || typeof p?.lng !== 'number') {
                throw new Error('Each polygon vertex must be { lat: number, lng: number }');
            }
        }
    } else {
        if (!address) throw new Error('`address` is required for count / budget / radius modes');
    }

    if (isBudgetMode) {
        if (typeof data.budget_usd !== 'number' || data.budget_usd <= 0) {
            throw new Error('Budget mode requires data.budget_usd as a positive number');
        }
        const derivedCount = Math.floor(data.budget_usd / PER_POSTCARD_USD);
        if (derivedCount < 1) {
            throw new Error(`budget_usd $${data.budget_usd} is below the per-postcard cost ($${PER_POSTCARD_USD})`);
        }
        data.count = derivedCount;
        ws.send(JSON.stringify({
            type: 'info',
            message: `Budget mode: $${data.budget_usd} / $${PER_POSTCARD_USD} = ${derivedCount} addresses target`,
        }));
    }
    if (isCountMode && (!data.count || data.count < 1)) {
        throw new Error('Count mode requires data.count as a positive integer');
    }
    if (isRadiusMode && (!data.radius || data.radius < 1)) {
        throw new Error('Radius mode requires data.radius (meters)');
    }
    if (data.radius && data.radius > 100 * METERS_PER_MILE) {
        throw new Error(`Radius cannot exceed ${Math.round(100 * METERS_PER_MILE)} meters (100 miles)`);
    }
    if (data.count && data.count > MAX_ADDRESSES_PER_SEARCH) {
        ws.send(JSON.stringify({
            type: 'warning',
            message: `Requested ${data.count} addresses, capped at ${MAX_ADDRESSES_PER_SEARCH} (send-capacity limit).`,
        }));
        data.count = MAX_ADDRESSES_PER_SEARCH;
    }
    data.mode = requestedMode;   // make sure fetchers see the resolved mode

    // ── Auth + service-role sanity ───────────────────────────────────────
    const authToken = headers.authorization?.replace('Bearer ', '') || headers.apikey;
    if (!authToken) throw new Error('Authorization token required');
    if (!SUPABASE_SERVICE_ROLE_KEY) {
        console.error('SUPABASE_SERVICE_ROLE_KEY environment variable not set');
        throw new Error('Server configuration error: Service role key not configured');
    }

    ws.send(JSON.stringify({ type: 'info', message: 'Starting address discovery process...' }));

    // ── 1. Center resolution ─────────────────────────────────────────────
    const center = isPolygonMode ? polygonCentroid(data.polygon) : await parseAddress(address, ws);

    // ── 2. Fetch from RentCast (only source — no OSM fallback) ────────────
    let rentcastProperties = null;
    let totalFound = 0;
    let mode, searchRadius;

    if (data.isTestMode === true) {
        ws.send(JSON.stringify({ type: 'progress', message: 'Test mode: generating sample addresses (RentCast skipped)...' }));
        rentcastProperties = buildTestProperties(center, data);
        totalFound = rentcastProperties.length;
        mode = requestedMode;
        searchRadius = data.radius || 1000;
        ws.send(JSON.stringify({ type: 'progress', message: `Generated ${rentcastProperties.length} test properties` }));
    } else {
        if (!RENTCAST_API_KEY) {
            throw new Error('RENTCAST_API_KEY not configured on the discovery service');
        }
        const rentcastResult = await fetchRentcastProperties(center, data, ws);
        rentcastProperties = rentcastResult.properties;
        totalFound = rentcastResult.totalFound;
        mode = rentcastResult.mode;
        searchRadius = rentcastResult.searchRadius;
        ws.send(JSON.stringify({ type: 'progress', message: `Found ${rentcastProperties.length} properties` }));
    }

    // Cap to MAX_ADDRESSES_PER_SEARCH
    if (rentcastProperties.length > MAX_ADDRESSES_PER_SEARCH) {
        const found = rentcastProperties.length;
        rentcastProperties = rentcastProperties.slice(0, MAX_ADDRESSES_PER_SEARCH);
        ws.send(JSON.stringify({
            type: 'warning',
            message: `Found ${found} properties; capped at ${MAX_ADDRESSES_PER_SEARCH} (send-capacity limit).`,
        }));
    }

    if (rentcastProperties.length === 0) {
        ws.send(JSON.stringify({
            type: 'complete',
            status: 'error',
            error: 'NO_BUILDINGS_FOUND',
            message: 'No properties found in the specified area. Adjust your radius / polygon / category filter.',
        }));
        return null;
    }

    const resultCount = rentcastProperties.length;

    // ── 3. Org + creator info ────────────────────────────────────────────
    const { organizationId, createdByInfo } = await resolveOrganization(authToken, ws);

    // ── 4. Zone metadata ─────────────────────────────────────────────────
    const zoneName = isPolygonMode
        ? `Polygon zone at ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`
        : (address.includes(',') && !address.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/)
            ? address.substring(0, 50)
            : `Zone at ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`);

    const zoneTypeStr = isPolygonMode ? 'polygon'
        : (mode === 'radius' ? `radius(${(searchRadius / 1000).toFixed(1)}km)`
            : `point(${data.count} addresses)`);

    // ── 5. Convert to address rows + assign stable ids ────────────────────
    ws.send(JSON.stringify({ type: 'progress', message: `Converting ${resultCount} properties to addresses...` }));

    const candidates = [];
    for (let i = 0; i < rentcastProperties.length; i++) {
        const property = rentcastProperties[i];
        const row = convertRentcastToAddress(property, center, createdByInfo, zoneName, zoneTypeStr);
        row.id = property.id ? `rc_${property.id}` : `rc_${i}`;
        row.included = true;   // default state for the curation UI
        candidates.push(row);
    }
    ws.send(JSON.stringify({ type: 'progress', message: `Processed ${candidates.length} addresses` }));

    const residentialCount = candidates.filter(a => a.residential).length;
    const otherCount = candidates.length - residentialCount;
    const processingTimeMs = Date.now() - startTime;

    // Build id → row map for O(1) curation toggles.
    const byId = new Map(candidates.map(c => [c.id, c]));

    const state = {
        candidates,
        byId,
        excluded: new Set(),
        center,
        mode,
        searchRadius,
        polygon: isPolygonMode ? data.polygon : null,
        totalFound,
        residentialCount,
        otherCount,
        processingTimeMs,
        zoneName,
        zoneTypeStr,
        organizationId,
        createdByInfo,
        campaign_id: campaign_id || null,
        address: address || null,
        searchData: data,
        subcategory_ids: data.subcategory_ids || null,
    };

    // Emit candidates to the client. The frontend uses `id` for curation
    // commands; default `included: true` for every row.
    ws.send(JSON.stringify({
        type: 'candidates',
        status: 'success',
        message: `Found ${candidates.length} candidate addresses`,
        mode,
        total: candidates.length,
        center: { lat: center.lat, long: center.lng, ...(isRadiusMode && { radius: data.radius }) },
        search_radius_meters: searchRadius,
        polygon: state.polygon,
        source: 'rentcast',
        residential_count: residentialCount,
        other_count: otherCount,
        candidates,   // full array — each has .id, .included, etc.
    }));

    return state;
}

function applyCuration(ws, message)
{
    const state = ws.discoveryState;
    if (!state) {
        ws.send(JSON.stringify({ status: 'error', error: 'NO_ACTIVE_SEARCH', message: 'No active search session. Send {cmd: "search", ...} first.' }));
        return;
    }
    const { cmd, address_id, address_ids } = message;
    const toToggle = address_id ? [address_id] : (Array.isArray(address_ids) ? address_ids : []);
    if (toToggle.length === 0) {
        ws.send(JSON.stringify({ status: 'error', error: 'INVALID_INPUT', message: 'exclude/include requires address_id or address_ids' }));
        return;
    }

    const isExclude = cmd === 'exclude' || cmd === 'exclude_many';
    const missing = [];
    for (const id of toToggle) {
        if (!state.byId.has(id)) { missing.push(id); continue; }
        if (isExclude) state.excluded.add(id); else state.excluded.delete(id);
        const row = state.byId.get(id);
        row.included = !state.excluded.has(id);
    }
    const selectedCount = state.candidates.length - state.excluded.size;
    ws.send(JSON.stringify({
        type: 'curation_update',
        cmd,
        toggled: toToggle.filter(id => state.byId.has(id)),
        missing,
        selected_count: selectedCount,
        excluded_count: state.excluded.size,
    }));
}

async function finalizeZone(ws, message)
{
    const state = ws.discoveryState;
    if (!state) {
        ws.send(JSON.stringify({ status: 'error', error: 'NO_ACTIVE_SEARCH', message: 'No active search session.' }));
        return;
    }
    const zoneName = (typeof message.zone_name === 'string' && message.zone_name.trim())
        ? message.zone_name.trim().substring(0, 200)
        : state.zoneName;

    // Build the curated subset
    const finalAddresses = state.candidates
        .filter(c => !state.excluded.has(c.id))
        .map(({ id: _id, included: _inc, ...rest }) => rest);   // strip socket-only fields

    if (finalAddresses.length === 0) {
        ws.send(JSON.stringify({
            type: 'complete',
            status: 'error',
            error: 'NO_ADDRESSES_SELECTED',
            message: 'All candidates were excluded — nothing to save.',
        }));
        return;
    }

    const residentialCount = finalAddresses.filter(a => a.residential).length;
    const otherCount = finalAddresses.length - residentialCount;

    // Unlink any prior zone on the same campaign (mirrors findaddresses behavior).
    if (state.campaign_id && state.organizationId) {
        try {
            await fetch(`${SUPABASE_URL}/rest/v1/location_zones?organization_id=eq.${state.organizationId}&campaign_id=eq.${state.campaign_id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    'apikey': SUPABASE_SERVICE_ROLE_KEY,
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({ campaign_id: null })
            });
        } catch (unlinkError) {
            console.error('Error unlinking existing zones from campaign:', unlinkError);
        }
    }

    const zoneData = {
        organization_id: state.organizationId,
        campaign_id: state.campaign_id || null,
        center: {
            lat: state.center.lat,
            long: state.center.lng,
            ...(state.mode === 'radius' && state.searchData?.radius && { radius: state.searchData.radius })
        },
        mode: state.mode,
        search_type: state.searchData?.searchType || 'ALL',
        metadata: {
            totalBuildingsFound: state.totalFound,
            addressesReturned: finalAddresses.length,
            originalCandidateCount: state.candidates.length,
            excludedCount: state.excluded.size,
            residentialCount,
            otherCount,
            processingTimeMs: state.processingTimeMs,
            source: 'rentcast',
            subcategory_ids: state.subcategory_ids,
            polygon: state.polygon,
            search_mode: state.mode,
            budget_usd: state.searchData?.budget_usd ?? null,
        },
        addresses: finalAddresses,
        zone_name: zoneName,
        zone_type: state.zoneTypeStr,
        address: state.address,
        manual_search: !state.campaign_id,
    };

    let zoneRecord = null;
    try {
        zoneRecord = await saveZoneToSupabase(zoneData, ws);

        if (state.campaign_id && zoneRecord?.id) {
            try {
                await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${state.campaign_id}&organization_id=eq.${state.organizationId}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify({ zone_id: zoneRecord.id })
                });
            } catch (updateError) {
                console.error('Error updating campaign with zone_id:', updateError);
            }
        }

        if (state.organizationId && zoneRecord?.id) {
            try {
                await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify({
                        organization_id: state.organizationId,
                        notification_type: 'NEW_TARGETING_ZONE_CREATED',
                        title: 'New Targeting Zone Created',
                        description: `New targeting zone "${zoneName}" created with ${finalAddresses.length} curated addresses`,
                        target_roles: ['MARKETER', 'ADMIN'],
                        metadata: {
                            zone_id: zoneRecord.id,
                            zone_name: zoneName,
                            zone_type: state.zoneTypeStr,
                            addresses_count: finalAddresses.length,
                            campaign_id: state.campaign_id || null,
                            source: 'rentcast',
                        },
                        is_read: false,
                    }),
                });
            } catch (notifyError) {
                console.error('Error creating notification:', notifyError);
            }
        }
    } catch (dbError) {
        console.error('Database operations failed:', dbError);
        ws.send(JSON.stringify({
            type: 'complete',
            status: 'error',
            error: 'DATABASE_ERROR',
            message: dbError.message || 'Failed to save zone',
        }));
        return;
    }

    ws.send(JSON.stringify({
        type: 'complete',
        status: 'success',
        message: `Saved ${finalAddresses.length} addresses to zone "${zoneName}"`,
        zone_id: zoneRecord?.id || null,
        saved_count: finalAddresses.length,
        excluded_count: state.excluded.size,
        original_candidate_count: state.candidates.length,
    }));

    // Done — drop the session state.
    ws.discoveryState = null;
}

// =============================================================================
// HTTP + WEBSOCKET SERVER
// =============================================================================

const server = http.createServer((req, res) =>
{
    if (req.url === '/' || req.url === '/health')
    {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'Discover Addresses WebSocket Server',
            timestamp: new Date().toISOString(),
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) =>
{
    console.log('New client connected');
    ws.discoveryState = null;

    ws.send(JSON.stringify({
        status: 'connected',
        message: 'Connected to discoveraddresses WebSocket. Send { cmd: "search", ... } to start.',
    }));

    ws.on('message', async (raw) =>
    {
        let message;
        try {
            message = JSON.parse(raw);
        } catch (e) {
            ws.send(JSON.stringify({ status: 'error', error: 'INVALID_JSON', message: e.message }));
            return;
        }

        const cmd = message.cmd || message.type;
        try {
            switch (cmd) {
                case 'search':
                case 'getAddressesFromZone':   // backwards-compat alias
                    ws.discoveryState = await runDiscoverySearch(ws, message);
                    break;

                case 'exclude':
                case 'include':
                case 'exclude_many':
                case 'include_many':
                    applyCuration(ws, message);
                    break;

                case 'finalize':
                    await finalizeZone(ws, message);
                    break;

                case 'cancel':
                    ws.discoveryState = null;
                    ws.send(JSON.stringify({ type: 'cancelled', message: 'Session cancelled, no zone saved.' }));
                    break;

                default:
                    ws.send(JSON.stringify({
                        status: 'error',
                        error: 'UNKNOWN_CMD',
                        message: `Unknown cmd "${cmd}". Valid: search, exclude, include, exclude_many, include_many, finalize, cancel.`,
                    }));
            }
        } catch (error) {
            console.error(`Error handling cmd ${cmd}:`, error);
            ws.send(JSON.stringify({
                status: 'error',
                error: 'INTERNAL_ERROR',
                cmd,
                message: error.message || 'An unexpected error occurred',
            }));
        }
    });

    ws.on('close', () => {
        ws.discoveryState = null;
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

server.listen(PORT, '0.0.0.0', () =>
{
    console.log(`\n🚀 Discover Addresses WebSocket Server running on port ${PORT}`);
    console.log(`📡 WebSocket endpoint: ws://0.0.0.0:${PORT}`);
    console.log(`🔗 Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`\nCommands: search | exclude | include | exclude_many | include_many | finalize | cancel\n`);
});

process.on('SIGTERM', () =>
{
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        wss.close(() => process.exit(0));
    });
});
