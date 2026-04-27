import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import http from 'http';

const PORT = process.env.PORT || 8080;
const SUPABASE_URL = 'https://xnflihspegizweqidvow.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OSM_NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const OSM_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT_BASE = 'DoorKnockerApp';
const getRandomUserAgent = () => `${USER_AGENT_BASE}/1.0-${Math.floor(Math.random() * 90000) + 10000}`;

// Retry configuration
const MAX_RETRIES = 5;
const NOMINATIM_MAX_RETRIES = 50;  // Keep retrying Nominatim until we get a result
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 32000;
const NOMINATIM_MAX_RETRY_DELAY = 60000;  // Cap Nominatim backoff at 60s
// Random delay between Nominatim calls: 1000–3000ms (randomness avoids looking like bulk scraping)
const getNominatimDelay = () => Math.floor(Math.random() * 2000) + 1000;

// Building classifications
const RESIDENTIAL_BUILDINGS = new Set([
    'apartments', 'house', 'detached', 'residential', 'semidetached_house',
    'terrace', 'dormitory', 'bungalow', 'static_caravan', 'cabin', 'houseboat',
    'semi', 'villa', 'townhouse', 'duplex', 'mansion', 'cottage', 'chalet',
    'condominium', 'farm', 'barracks'
]);

// ==================== UTILITY FUNCTIONS ====================

function getUserFromToken(authToken)
{
    try
    {
        // Decode JWT token (without verification, as it's already verified by the client)
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

// Dedicated retry function for Nominatim — retries up to NOMINATIM_MAX_RETRIES times on 429,
// respects Retry-After headers, and uses exponential backoff capped at NOMINATIM_MAX_RETRY_DELAY.
async function retryNominatim(fn, ws, retryAfterRef)
{
    let lastError;

    for (let attempt = 0; attempt < NOMINATIM_MAX_RETRIES; attempt++)
    {
        try
        {
            if (attempt > 0)
            {
                // Use Retry-After from response header if available, otherwise exponential backoff
                const backoff = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1), NOMINATIM_MAX_RETRY_DELAY);
                const jitter = backoff * (0.75 + Math.random() * 0.5);
                const delay = retryAfterRef.value ? retryAfterRef.value * 1000 : Math.floor(jitter);
                retryAfterRef.value = null;  // Reset after consuming

                ws.send(JSON.stringify({
                    type: 'retry',
                    message: `Retrying Nominatim reverse geocoding (attempt ${attempt + 1}/${NOMINATIM_MAX_RETRIES})...`,
                    delay: delay
                }));
                await sleep(delay);
            }

            return await fn();
        } catch (error)
        {
            lastError = error;

            // Don't retry on non-rate-limit client errors
            if (error.status >= 400 && error.status < 500 && error.status !== 429)
            {
                throw error;
            }

            if (attempt < NOMINATIM_MAX_RETRIES - 1)
            {
                ws.send(JSON.stringify({
                    type: 'warning',
                    message: `Nominatim reverse geocoding failed: ${error.message}. Retrying...`
                }));
            }
        }
    }

    throw new Error(`Nominatim reverse geocoding failed after ${NOMINATIM_MAX_RETRIES} attempts: ${lastError.message}`);
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

async function fetchOpenStreetMapBuildings(center, data, ws)
{
    const { radius, count, searchType = 'ALL' } = data;
    const isCountMode = count && !radius;
    let searchRadius = radius || 2000;

    if (isCountMode)
    {
        ws.send(JSON.stringify({
            type: 'progress',
            message: `Finding approximately ${count} buildings...`
        }));
    } else
    {
        ws.send(JSON.stringify({
            type: 'progress',
            message: `Searching for buildings within ${radius}m radius...`
        }));
    }

    const fetchBuildings = async () =>
    {
        const query = `
      [out:json][timeout:90];
      (
        way["building"](around:${searchRadius},${center.lat},${center.lng});
        relation["building"](around:${searchRadius},${center.lat},${center.lng});
      );
      out body;
      >;
      out skel qt;
    `;

        const response = await fetch(OSM_OVERPASS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': USER_AGENT_BASE
            },
            body: `data=${encodeURIComponent(query)}`
        });

        if (!response.ok)
        {
            const error = new Error(`error: ${response.statusText}`);
            error.status = response.status;
            throw error;
        }

        const result = await response.json();
        return result.elements || [];
    };

    const elements = await retryWithBackoff(fetchBuildings, ws, 'Building discovery');

    const buildings = [];
    const nodeCache = {};

    elements.forEach(el =>
    {
        if (el.type === 'node')
        {
            nodeCache[el.id] = { lat: el.lat, lon: el.lon };
        }
    });

    for (const element of elements)
    {
        if (element.type === 'way' || element.type === 'relation')
        {
            if (!element.tags || !element.tags.building) continue;

            let lat = 0, lon = 0, count = 0;

            if (element.nodes)
            {
                for (const nodeId of element.nodes)
                {
                    if (nodeCache[nodeId])
                    {
                        lat += nodeCache[nodeId].lat;
                        lon += nodeCache[nodeId].lon;
                        count++;
                    }
                }
            }

            if (count > 0)
            {
                lat /= count;
                lon /= count;

                const buildingType = element.tags.building === 'yes' ? 'building' : element.tags.building;
                const isResidential = RESIDENTIAL_BUILDINGS.has(buildingType);

                buildings.push({
                    lat,
                    lon,
                    tags: element.tags,
                    osm_id: `way/${element.id}`,
                    building_type: buildingType,
                    residential: isResidential
                });
            }
        }
    }

    ws.send(JSON.stringify({
        type: 'progress',
        message: `Found ${buildings.length} buildings`
    }));

    let filtered = buildings;
    if (searchType === 'RESIDENTIAL')
    {
        filtered = buildings.filter(b => b.residential);
    } else if (searchType === 'OTHER')
    {
        filtered = buildings.filter(b => !b.residential);
    }

    if (isCountMode && filtered.length > count)
    {
        filtered = filtered
            .map(b => ({
                ...b,
                distance: calculateDistance(center.lat, center.lng, b.lat, b.lon)
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, count);
    }

    return {
        buildings: filtered,
        totalFound: buildings.length,
        mode: isCountMode ? 'count' : 'radius',
        searchRadius
    };
}

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

async function convertOsmToAddress(building, center, ws, createdBy, zoneName, zoneTypeStr)
{
    const tags = building.tags || {};
    const rawHousenumber = tags['addr:housenumber'] || tags.housenumber;
    const housenumber = rawHousenumber ? rawHousenumber.split(';')[0].trim() : undefined;
    const street = tags['addr:street'] || tags.street;
    const city = tags['addr:city'] || tags.city;
    const state = tags['addr:state'] || tags.state;
    const postcode = tags['addr:postcode'] || tags.postcode;

    let address = null;

    if (housenumber && street)
    {
        // OSM tags have full address info — build it directly
        const parts = [
            housenumber + ' ' + street,
            city,
            state,
            postcode
        ].filter(Boolean);
        address = parts.join(', ');
    } else if (tags.name && housenumber)
    {
        // Named building with a house number
        const parts = [housenumber + ' ' + tags.name, city, state, postcode].filter(Boolean);
        address = parts.join(', ');
    }

    // Fallback: use Nominatim reverse geocoding (OSM-only, no Google)
    if (!address)
    {
        // retryAfterRef lets the fetch handler pass the Retry-After header value back to the retry loop
        const retryAfterRef = { value: null };

        const reverseGeocode = async () =>
        {
            const response = await fetch(
                `${OSM_NOMINATIM_URL}/reverse?format=jsonv2&lat=${building.lat}&lon=${building.lon}&zoom=18&addressdetails=1`,
                {
                    headers: {
                        'User-Agent': getRandomUserAgent(),
                        'Accept-Language': 'en'
                    }
                }
            );

            if (!response.ok)
            {
                // Capture Retry-After header on 429 so the retry loop can honour it
                if (response.status === 429)
                {
                    const retryAfter = response.headers.get('Retry-After');
                    if (retryAfter)
                    {
                        retryAfterRef.value = parseInt(retryAfter, 10) || null;
                    }
                }
                const error = new Error(`Nominatim reverse geocoding error: ${response.statusText}`);
                error.status = response.status;
                throw error;
            }

            const data = await response.json();

            if (data && data.address)
            {
                const a = data.address;
                // Build a structured address from Nominatim's response fields
                const houseNum = a.house_number || '';
                const roadName = a.road || a.pedestrian || a.footway || a.path || '';
                const line1 = houseNum && roadName
                    ? `${houseNum} ${roadName}`
                    : roadName || houseNum || data.display_name.split(',')[0];
                const resolvedCity = a.city || a.town || a.village || a.hamlet || a.suburb || '';
                const resolvedState = a.state || '';
                const resolvedPostcode = a.postcode || '';

                const parts = [line1, resolvedCity, resolvedState, resolvedPostcode].filter(Boolean);
                return parts.join(', ');
            }

            // Last resort: use display_name from Nominatim
            if (data && data.display_name)
            {
                return data.display_name;
            }

            return null;
        };

        try
        {
            address = await retryNominatim(reverseGeocode, ws, retryAfterRef);
        } catch (error)
        {
            console.warn(`Nominatim reverse geocoding failed for ${building.lat},${building.lon}:`, error.message);
        }
    }

    // Absolute last resort: coordinates
    if (!address)
    {
        address = `${building.lat.toFixed(6)}, ${building.lon.toFixed(6)}`;
    }

    return {
        lat: building.lat,
        long: building.lon,
        address,
        residential: building.residential,
        building_type: building.building_type,
        osm_id: building.osm_id,
        propertyType: building.residential ? 'Single Family Home' : 'Other',
        distanceFromCenter: calculateDistance(center.lat, center.lng, building.lat, building.lon),
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

// ==================== MAIN HANDLER ====================

async function handleGetAddressesFromZone(ws, message)
{
    const startTime = Date.now();

    try
    {
        const { address, data, campaign_id, headers = {} } = message;

        if (!address)
        {
            throw new Error('Address is required');
        }
        if (!data || (!data.radius && !data.count))
        {
            throw new Error('Either radius or count is required in data');
        }
        if (data.radius && data.radius > 50000)
        {
            throw new Error('Radius cannot exceed 50,000 meters');
        }
        if (data.count && data.count > 10000)
        {
            throw new Error('Count cannot exceed 10,000 buildings');
        }

        const authToken = headers.authorization?.replace('Bearer ', '') || headers.apikey;
        if (!authToken)
        {
            throw new Error('Authorization token required');
        }

        // Use service role key from environment (same as edge function)
        if (!SUPABASE_SERVICE_ROLE_KEY)
        {
            console.error('SUPABASE_SERVICE_ROLE_KEY environment variable not set');
            throw new Error('Server configuration error: Service role key not configured');
        }

        // No Google API key needed — reverse geocoding uses Nominatim (OSM)

        ws.send(JSON.stringify({
            type: 'info',
            message: 'Starting address discovery process...'
        }));

        // Parse address
        const center = await parseAddress(address, ws);

        // Fetch buildings
        const { buildings, totalFound, mode, searchRadius } = await fetchOpenStreetMapBuildings(
            center,
            data,
            ws
        );

        if (buildings.length === 0)
        {
            ws.send(JSON.stringify({
                type: 'complete',
                status: 'error',
                error: 'NO_BUILDINGS_FOUND',
                message: 'No buildings found in the specified area. Try increasing the radius or adjusting the search area.'
            }));
            return;
        }

        // Get user info and organization
        let organizationId = null;
        let createdByInfo = null;

        const userFromToken = getUserFromToken(authToken);
        if (userFromToken)
        {
            try
            {
                // 1. Get user profile (includes active_organization_id)
                console.log('Fetching user profile for organization lookup...');
                const profileResponse = await fetch(
                    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userFromToken.userId}&select=id,role,full_name,created_at,updated_at,active_organization_id`,
                    {
                        headers: {
                            'apikey': SUPABASE_SERVICE_ROLE_KEY,
                            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                        }
                    }
                );

                if (profileResponse.ok)
                {
                    const profiles = await profileResponse.json();
                    if (profiles && profiles.length > 0)
                    {
                        const profile = profiles[0];

                        createdByInfo = {
                            id: profile.id,
                            user_role: profile.role,
                            full_name: profile.full_name || userFromToken.userName,
                            created_at: profile.created_at,
                            updated_at: profile.updated_at
                        };

                        // Helper to verify membership
                        const verifyMembership = async (orgId, userId) => {
                            const resp = await fetch(
                                `${SUPABASE_URL}/rest/v1/organizations?id=eq.${orgId}&select=id,owner_id,organization_members`,
                                {
                                    headers: {
                                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                                    }
                                }
                            );
                            if (!resp.ok) return false;
                            const orgs = await resp.json();
                            if (!orgs || orgs.length === 0) return false;
                            const org = orgs[0];
                            if (org.owner_id === userId) return true;
                            const members = org.organization_members || [];
                            return Array.isArray(members) && members.some(m => m && m.member_uid === userId);
                        };

                        // 2. Check active_organization_id first (Reliable for multi-org users)
                        if (profile.active_organization_id) {
                            console.log(`Found active_organization_id ${profile.active_organization_id} in profile. Verifying...`);
                            const isValid = await verifyMembership(profile.active_organization_id, userFromToken.userId);
                            if (isValid) {
                                console.log(`Verified active_organization_id ${profile.active_organization_id} is valid for user.`);
                                organizationId = profile.active_organization_id;
                            } else {
                                console.warn(`active_organization_id ${profile.active_organization_id} is not valid for user. Falling back to scan.`);
                            }
                        }

                        // 3. Fallback scan if no active org or not verified
                        if (!organizationId) {
                            console.log('Scanning organizations for ownership/membership...');
                            const allOrgsResponse = await fetch(
                                `${SUPABASE_URL}/rest/v1/organizations?select=id,owner_id,organization_members`,
                                {
                                    headers: {
                                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
                                    }
                                }
                            );

                            if (allOrgsResponse.ok) {
                                const allOrgs = await allOrgsResponse.json();
                                for (const org of allOrgs) {
                                    if (org.owner_id === userFromToken.userId) {
                                        organizationId = org.id;
                                        break;
                                    }
                                    const members = org.organization_members || [];
                                    if (Array.isArray(members) && members.some(m => m && m.member_uid === userFromToken.userId)) {
                                        organizationId = org.id;
                                        break;
                                    }
                                }
                            }

                            // 4. Update profile with found org for next time
                            if (organizationId) {
                                console.log(`Found organization ${organizationId} via scan. Updating active_organization_id on profile...`);
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

                        if (organizationId) {
                            console.log(`Final Organization ID for zone creation: ${organizationId}`);
                        } else {
                            console.error(`Could not determine organization for user ${userFromToken.userId}`);
                        }
                    } else
                    {
                        console.error('No profile found for user:', userFromToken.userId);
                        // Fallback createdByInfo if no profile
                        createdByInfo = {
                            id: userFromToken.userId,
                            user_role: 'TECHNICIAN',
                            full_name: userFromToken.userName,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        };
                    }
                } else
                {
                    const errorText = await profileResponse.text();
                    console.error('Failed to get profile:', profileResponse.status, profileResponse.statusText, errorText);
                }
            } catch (userError)
            {
                console.error('Error getting user profile/org:', userError);
            }
        } else
        {
            console.error('Failed to decode user from JWT token');
        }

        // Calculate zone details (Moved up to be available for address conversion)
        const zoneName = address.includes(',') && !address.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/)
            ? address.substring(0, 50)
            : `Zone at ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;

        const zoneTypeStr = mode === 'radius'
            ? `radius(${(searchRadius / 1000).toFixed(1)}km)`
            : `point(${data.count} addresses)`;

        // Convert to addresses
        ws.send(JSON.stringify({
            type: 'progress',
            message: `Converting ${buildings.length} buildings to addresses...`
        }));

        const addresses = [];
        // Process buildings sequentially to respect Nominatim's 1 req/s rate limit.
        // Buildings with OSM address tags skip Nominatim entirely, so the delay only
        // applies to those that actually need reverse geocoding.
        let lastNominatimCallTime = 0;

        for (let i = 0; i < buildings.length; i++)
        {
            const building = buildings[i];
            const tags = building.tags || {};
            const needsNominatim = !(tags['addr:housenumber'] || tags.housenumber) ||
                                   !(tags['addr:street'] || tags.street);

            // Enforce a random gap between Nominatim calls (1–3s) to avoid rate limiting
            if (needsNominatim)
            {
                const now = Date.now();
                const elapsed = now - lastNominatimCallTime;
                const delay = getNominatimDelay();
                if (elapsed < delay)
                {
                    await sleep(delay - elapsed);
                }
                lastNominatimCallTime = Date.now();
            }

            const result = await convertOsmToAddress(building, center, ws, createdByInfo, zoneName, zoneTypeStr);
            addresses.push(result);

            if ((i + 1) % 10 === 0 || i === buildings.length - 1)
            {
                ws.send(JSON.stringify({
                    type: 'progress',
                    message: `Processed ${i + 1}/${buildings.length} addresses...`
                }));
            }
        }

        const residentialCount = addresses.filter(a => a.residential).length;
        const otherCount = addresses.length - residentialCount;
        const processingTimeMs = Date.now() - startTime;

        // If campaign_id is provided, unlink ALL existing zones from this campaign first
        // This ensures only the newest search zone is linked to the campaign
        if (campaign_id && organizationId)
        {
            try
            {
                const unlinkResponse = await fetch(`${SUPABASE_URL}/rest/v1/location_zones?organization_id=eq.${organizationId}&campaign_id=eq.${campaign_id}`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                        'apikey': SUPABASE_SERVICE_ROLE_KEY,
                        'Prefer': 'return=minimal'
                    },
                    body: JSON.stringify({ campaign_id: null })
                });

                if (!unlinkResponse.ok)
                {
                    const errorText = await unlinkResponse.text();
                    console.error("Error unlinking existing zones from campaign:", unlinkResponse.status, errorText);
                    // Don't fail the request, just log the error
                }
            } catch (unlinkError)
            {
                console.error("Error unlinking existing zones from campaign:", unlinkError);
            }
        }

        // Save zone to database
        let zoneRecord = null;
        try
        {
            const zoneData = {
                organization_id: organizationId,
                campaign_id: campaign_id || null,
                center: {
                    lat: center.lat,
                    long: center.lng,
                    ...(mode === 'radius' && { radius: data.radius })
                },
                mode,
                search_type: data.searchType || 'ALL',
                metadata: {
                    totalBuildingsFound: totalFound,
                    addressesReturned: addresses.length,
                    residentialCount,
                    otherCount,
                    processingTimeMs
                },
                addresses: addresses,
                zone_name: zoneName,
                zone_type: zoneTypeStr,
                address: address,
                manual_search: !campaign_id || campaign_id === '' // true if campaign_id is empty string or not provided
            };

            zoneRecord = await saveZoneToSupabase(zoneData, ws);

            // Update campaign with zone_id if campaign_id was provided
            if (campaign_id && zoneRecord?.id)
            {
                try
                {
                    await fetch(`${SUPABASE_URL}/rest/v1/campaigns?id=eq.${campaign_id}&organization_id=eq.${organizationId}`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                            'apikey': SUPABASE_SERVICE_ROLE_KEY,
                            'Prefer': 'return=minimal'
                        },
                        body: JSON.stringify({ zone_id: zoneRecord.id })
                    });
                } catch (updateError)
                {
                    console.error('Error updating campaign with zone_id:', updateError);
                }
            }

            // Create notification (MARKETER_AND_ADMIN)
            if (organizationId && zoneRecord?.id)
            {
                try
                {
                    const notificationData = {
                        organization_id: organizationId,
                        notification_type: "NEW_TARGETING_ZONE_CREATED",
                        title: "New Targeting Zone Created",
                        description: `New targeting zone "${zoneName}" created with ${addresses.length} addresses`,
                        target_roles: ["MARKETER", "ADMIN"],
                        metadata: {
                            zone_id: zoneRecord.id,
                            zone_name: zoneName,
                            zone_type: zoneTypeStr,
                            addresses_count: addresses.length,
                            campaign_id: campaign_id || null,
                            center_lat: center.lat,
                            center_lng: center.lng,
                            radius: mode === 'radius' ? data.radius : null
                        },
                        is_read: false
                    };

                    await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                            'apikey': SUPABASE_SERVICE_ROLE_KEY,
                            'Prefer': 'return=minimal'
                        },
                        body: JSON.stringify(notificationData)
                    });
                } catch (notifyError)
                {
                    console.error('Error creating notification:', notifyError);
                }
            }

        } catch (dbError)
        {
            console.error('Database operations failed:', dbError);
        }

        // Send final response in edge function format
        const finalResponse = {
            type: 'complete',
            status: 'success',
            message: `Found ${addresses.length} addresses`,
            center: {
                lat: center.lat,
                long: center.lng,
                ...(mode === 'radius' && { radius: data.radius })
            },
            mode,
            searchType: data.searchType || 'ALL',
            metadata: {
                totalBuildingsFound: totalFound,
                addressesReturned: addresses.length,
                residentialCount,
                otherCount,
                processingTimeMs
            },
            addresses,
            zone_id: zoneRecord?.id || null
        };

        ws.send(JSON.stringify(finalResponse));

    } catch (error)
    {
        ws.send(JSON.stringify({
            type: 'complete',
            status: 'error',
            error: 'INTERNAL_ERROR',
            message: error.message || 'An unexpected error occurred',
            stack: error.stack
        }));
    }
}

// ==================== HTTP + WEBSOCKET SERVER ====================

// Create HTTP server for health checks and WebSocket upgrade
const server = http.createServer((req, res) =>
{
    // Health check endpoint for Cloud Run
    if (req.url === '/' || req.url === '/health')
    {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'Address WebSocket Server',
            timestamp: new Date().toISOString()
        }));
    } else
    {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// Create WebSocket server using the HTTP server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) =>
{
    console.log('New client connected');

    ws.send(JSON.stringify({
        status: 'connected',
        message: 'Connected to Address WebSocket Server'
    }));

    ws.on('message', async (data) =>
    {
        try
        {
            console.log('Received message:', data.toString().substring(0, 200) + '...');
            const message = JSON.parse(data);

            if (message.type === 'getAddressesFromZone' || message.address)
            {
                console.log('Processing getAddressesFromZone request...');
                await handleGetAddressesFromZone(ws, message);
                console.log('Request processing complete');
            } else
            {
                ws.send(JSON.stringify({
                    status: 'error',
                    message: 'Invalid message format. Expected: { "type": "getAddressesFromZone", "address": "...", "data": {...}, "headers": {...} }'
                }));
            }
        } catch (error)
        {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                status: 'error',
                message: 'Invalid JSON message',
                error: error.message
            }));
        }
    });

    ws.on('close', () =>
    {
        console.log('Client disconnected');
    });

    ws.on('error', (error) =>
    {
        console.error('WebSocket error:', error);
    });
});

// Start the server
server.listen(PORT, '0.0.0.0', () =>
{
    console.log(`\n🚀 Address WebSocket Server running on port ${PORT}`);
    console.log(`📡 WebSocket endpoint: ws://0.0.0.0:${PORT}`);
    console.log(`🔗 Health check: http://0.0.0.0:${PORT}/health`);
    console.log(`\nMessage format:`);
    console.log(`{`);
    console.log(`  "type": "getAddressesFromZone",`);
    console.log(`  "address": "lat,lng or text address",`);
    console.log(`  "data": { "radius": 1000, "searchType": "RESIDENTIAL" },`);
    console.log(`  "headers": { "authorization": "Bearer TOKEN", "apikey": "KEY" }`);
    console.log(`}\n`);
});

// Graceful shutdown handling for Cloud Run
process.on('SIGTERM', () =>
{
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() =>
    {
        console.log('HTTP server closed');
        wss.close(() =>
        {
            console.log('WebSocket server closed');
            process.exit(0);
        });
    });
});