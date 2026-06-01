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
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// Rentcast — primary property source for US residential addresses
const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY;
const RENTCAST_BASE_URL = 'https://api.rentcast.io/v1';
const METERS_PER_MILE = 1609.344;
const RENTCAST_RESIDENTIAL_TYPES = new Set([
    'Single Family', 'Condo', 'Townhouse', 'Manufactured', 'Multi-Family', 'Apartment'
]);

// Retry configuration
const MAX_RETRIES = 5;
const NOMINATIM_MAX_RETRIES = 50;  // Keep retrying Nominatim until we get a result
const INITIAL_RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 32000;
const NOMINATIM_MAX_RETRY_DELAY = 60000;  // Cap Nominatim backoff at 60s
// Random delay between Nominatim calls: 1000–3000ms (randomness avoids looking like bulk scraping)
const getNominatimDelay = () => Math.floor(Math.random() * 2000) + 1000;

// Building classifications (used by OSM fallback path)
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
                const backoff = Math.min(INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1), NOMINATIM_MAX_RETRY_DELAY);
                const jitter = backoff * (0.75 + Math.random() * 0.5);
                const delay = retryAfterRef.value ? retryAfterRef.value * 1000 : Math.floor(jitter);
                retryAfterRef.value = null;

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

async function fetchRentcastProperties(center, data, ws)
{
    const { radius, count, searchType = 'ALL' } = data;
    const isCountMode = !!(count && !radius);
    const PAGE_SIZE = 500;

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

    const applyFilter = (properties) =>
    {
        if (searchType === 'RESIDENTIAL') return properties.filter(p => RENTCAST_RESIDENTIAL_TYPES.has(p.propertyType));
        if (searchType === 'OTHER') return properties.filter(p => !RENTCAST_RESIDENTIAL_TYPES.has(p.propertyType));
        return properties;
    };

    const annotateAndSort = (properties) =>
        properties
            .map(p => ({ ...p, _dist: calculateDistance(center.lat, center.lng, p.latitude, p.longitude) }))
            .sort((a, b) => a._dist - b._dist);

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
    const MAX_RADIUS_MILES = 25;
    let best = { properties: [], totalCount: null };

    while (radiusMiles <= MAX_RADIUS_MILES)
    {
        const { allProperties, totalCount } = await fetchPage(radiusMiles, count * 2);
        const filtered = annotateAndSort(applyFilter(allProperties));
        best = { properties: filtered, totalCount };

        if (filtered.length >= count) break;
        // Bail once we've tried the cap — otherwise Math.min(MAX, ...) keeps
        // pinning radius at MAX and the loop hammers RentCast forever for
        // remote areas with zero coverage (e.g. Alaska wilderness).
        if (radiusMiles >= MAX_RADIUS_MILES) break;

        // Estimate the radius needed using observed density; enforce minimum 1.5× growth
        if (filtered.length > 0)
        {
            const density = filtered.length / (Math.PI * radiusMiles * radiusMiles);
            const needed = Math.sqrt(count / (Math.PI * density)) * 1.1;
            radiusMiles = Math.min(MAX_RADIUS_MILES, Math.max(radiusMiles * 1.5, needed));
        } else
        {
            radiusMiles = Math.min(MAX_RADIUS_MILES, radiusMiles * 2);
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
            .map(b => ({ ...b, distance: calculateDistance(center.lat, center.lng, b.lat, b.lon) }))
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
        const parts = [
            housenumber + ' ' + street,
            city,
            state,
            postcode
        ].filter(Boolean);
        address = parts.join(', ');
    } else if (tags.name && housenumber)
    {
        const parts = [housenumber + ' ' + tags.name, city, state, postcode].filter(Boolean);
        address = parts.join(', ');
    }

    if (!address && GOOGLE_MAPS_API_KEY)
    {
        // Google reverse geocoding. Used exclusively here — Nominatim reverse
        // got rate-limited too aggressively in practice (50-retry loop with
        // exponential backoff up to 60s emitted long visible delays to the
        // frontend). Google's quota and reliability dominate that trade-off
        // even though we pay ~$0.005 per call. This path only fires when
        // RentCast returned no properties and we fell through to OSM Overpass,
        // so it's a small slice of total traffic.
        try
        {
            const googleResp = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?latlng=${building.lat},${building.lon}&key=${GOOGLE_MAPS_API_KEY}`
            );
            if (googleResp.ok)
            {
                const googleData = await googleResp.json();
                if (googleData.status === 'OK' && googleData.results?.length > 0)
                {
                    // Strip the trailing country (", USA" / ", United States" / ", Canada")
                    // to match the address format used elsewhere in this codebase.
                    const formatted = googleData.results[0].formatted_address || '';
                    address = formatted.replace(/,\s*(USA|United States|Canada)$/i, '').trim() || formatted;
                }
            } else
            {
                console.warn(`Google reverse geocoding HTTP ${googleResp.status} for ${building.lat},${building.lon}`);
            }
        } catch (googleError)
        {
            console.warn(`Google reverse geocoding failed for ${building.lat},${building.lon}:`, googleError.message);
        }
    }

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

        if (!SUPABASE_SERVICE_ROLE_KEY)
        {
            console.error('SUPABASE_SERVICE_ROLE_KEY environment variable not set');
            throw new Error('Server configuration error: Service role key not configured');
        }

        ws.send(JSON.stringify({
            type: 'info',
            message: 'Starting address discovery process...'
        }));

        // ── 1. Geocode input address ─────────────────────────────────────────
        const center = await parseAddress(address, ws);

        // ── 2. Fetch properties: Rentcast first, OSM as fallback ─────────────
        // Test-mode short-circuit: if isTestMode is true on the request payload,
        // skip RentCast + OSM and synthesise canned residential properties
        // around the geocoded center. Useful when the dev RentCast key only
        // returns SF data, or when QA wants deterministic, quota-free results.
        let fetchSource = 'osm';
        let rentcastProperties = null;
        let osmBuildings = null;
        let totalFound = 0;
        let mode, searchRadius;

        if (data?.isTestMode === true)
        {
            ws.send(JSON.stringify({
                type: 'progress',
                message: 'Test mode: generating sample addresses (RentCast skipped)...'
            }));
            rentcastProperties = buildTestProperties(center, data);
            fetchSource = 'rentcast';   // downstream save/convert treat test == rentcast
            totalFound = rentcastProperties.length;
            mode = data?.count ? 'count' : 'radius';
            searchRadius = data?.radius || 1000;
            ws.send(JSON.stringify({
                type: 'progress',
                message: `Generated ${rentcastProperties.length} test properties`
            }));
        }
        else if (RENTCAST_API_KEY)
        {
            try
            {
                const rentcastResult = await fetchRentcastProperties(center, data, ws);

                if (rentcastResult.properties.length > 0)
                {
                    fetchSource = 'rentcast';
                    rentcastProperties = rentcastResult.properties;
                    totalFound = rentcastResult.totalFound;
                    mode = rentcastResult.mode;
                    searchRadius = rentcastResult.searchRadius;

                    ws.send(JSON.stringify({
                        type: 'progress',
                        message: `Found ${rentcastResult.properties.length} properties`
                    }));
                } else
                {
                    ws.send(JSON.stringify({
                        type: 'progress',
                        message: 'Searching OpenStreetMap...'
                    }));
                }
            } catch (rentcastError)
            {
                console.warn('Property search unavailable, falling back to OSM:', rentcastError.message);
                ws.send(JSON.stringify({
                    type: 'progress',
                    message: 'Searching OpenStreetMap...'
                }));
            }
        }

        if (fetchSource === 'osm')
        {
            const osmResult = await fetchOpenStreetMapBuildings(center, data, ws);
            osmBuildings = osmResult.buildings;
            totalFound = osmResult.totalFound;
            mode = osmResult.mode;
            searchRadius = osmResult.searchRadius;
        }

        const resultCount = fetchSource === 'rentcast'
            ? rentcastProperties.length
            : (osmBuildings?.length ?? 0);

        if (resultCount === 0)
        {
            ws.send(JSON.stringify({
                type: 'complete',
                status: 'error',
                error: 'NO_BUILDINGS_FOUND',
                message: 'No properties found in the specified area. Try increasing the radius or adjusting the search area.'
            }));
            return;
        }

        // ── 3. Auth + org lookup ─────────────────────────────────────────────
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

        // ── 4. Zone metadata ─────────────────────────────────────────────────
        const zoneName = address.includes(',') && !address.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/)
            ? address.substring(0, 50)
            : `Zone at ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`;

        const zoneTypeStr = mode === 'radius'
            ? `radius(${(searchRadius / 1000).toFixed(1)}km)`
            : `point(${data.count} addresses)`;

        // ── 5. Convert to addresses ──────────────────────────────────────────
        ws.send(JSON.stringify({
            type: 'progress',
            message: `Converting ${resultCount} properties to addresses...`
        }));

        const addresses = [];

        if (fetchSource === 'rentcast')
        {
            for (const property of rentcastProperties)
            {
                addresses.push(convertRentcastToAddress(property, center, createdByInfo, zoneName, zoneTypeStr));
            }
            ws.send(JSON.stringify({
                type: 'progress',
                message: `Processed ${addresses.length} addresses`
            }));
        } else
        {
            // OSM path — sequential to respect Nominatim's 1 req/s rate limit
            let lastNominatimCallTime = 0;

            for (let i = 0; i < osmBuildings.length; i++)
            {
                const building = osmBuildings[i];
                const tags = building.tags || {};
                const needsNominatim = !(tags['addr:housenumber'] || tags.housenumber) ||
                                       !(tags['addr:street'] || tags.street);

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

                if ((i + 1) % 10 === 0 || i === osmBuildings.length - 1)
                {
                    ws.send(JSON.stringify({
                        type: 'progress',
                        message: `Processed ${i + 1}/${osmBuildings.length} addresses...`
                    }));
                }
            }
        }

        const residentialCount = addresses.filter(a => a.residential).length;
        const otherCount = addresses.length - residentialCount;
        const processingTimeMs = Date.now() - startTime;

        // ── 6. Unlink old zones from campaign ────────────────────────────────
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
                }
            } catch (unlinkError)
            {
                console.error("Error unlinking existing zones from campaign:", unlinkError);
            }
        }

        // ── 7. Save zone ─────────────────────────────────────────────────────
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
                    processingTimeMs,
                    source: fetchSource
                },
                addresses: addresses,
                zone_name: zoneName,
                zone_type: zoneTypeStr,
                address: address,
                manual_search: !campaign_id || campaign_id === ''
            };

            zoneRecord = await saveZoneToSupabase(zoneData, ws);

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
                            radius: mode === 'radius' ? data.radius : null,
                            source: fetchSource
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

        // ── 8. Final response ────────────────────────────────────────────────
        ws.send(JSON.stringify({
            type: 'complete',
            status: 'success',
            message: `Found ${addresses.length} addresses`,
            source: fetchSource,
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
                processingTimeMs,
                source: fetchSource
            },
            addresses,
            zone_id: zoneRecord?.id || null
        }));

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

const server = http.createServer((req, res) =>
{
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
