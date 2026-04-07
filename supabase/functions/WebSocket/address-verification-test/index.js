import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import http from 'http';

// =============================================================================
// CONFIGURATION - API KEYS & URLS
// =============================================================================
const PORT = process.env.PORT || 8080;

const SUPABASE_URL = 'https://xnflihspegizweqidvow.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POSTGRID_API_KEY = process.env.POSTGRID_API_KEY;

const VERIFICATION_API_URL = 'https://api.postgrid.com/v1/addver/verifications';

// =============================================================================
// TEST DATA
// =============================================================================
const isTestMode = true; // Set to true to inject mock data if no addresses are verified

function getTestAddresses(count) {
  const addresses = [];
  const baseLat = 37.7749;
  const baseLong = -122.4194;

  for (let i = 0; i < count; i++) {
    // Generate a random street number (e.g. 100 to 9999)
    const randomStreetNum = Math.floor(Math.random() * 9900) + 100;
    
    // Add some random jitter to lat/long to simulate different locations
    const latOffset = (Math.random() - 0.5) * 0.01;
    const longOffset = (Math.random() - 0.5) * 0.01;
    
    addresses.push({
      lat: baseLat + latOffset,
      long: baseLong + longOffset,
      address: `${randomStreetNum} Market St, San Francisco, CA 94102`,
      residential: true,
      building_type: 'house',
      osm_id: `way/${1001 + i + Math.floor(Math.random() * 1000)}`,
      propertyType: 'Single Family Home',
      distanceFromCenter: 500 + (i * 10) + Math.floor(Math.random() * 50),
      targeting_zone_name: 'San Francisco Area',
      campaigns_used_in: [],
      zoneType: 'radius',
      postcards_sent: 0,
      first_post_card_sent_date: null,
      status: 'Valid',
      verified: true,
      verification_details: {
        status: 'verified',
        line1: `${randomStreetNum} Market St`,
        city: 'San Francisco',
        provinceOrState: 'CA',
        postalOrZip: '94102'
      },
      createdBy: {
        id: null,
        user_role: 'TECHNICIAN',
        full_name: 'System',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    });
  }
  
  return addresses;
}



// =============================================================================
// HTTP SERVER WITH WEBSOCKET SUPPORT
// =============================================================================
const server = http.createServer((req, res) => {
    // Health check endpoint for Cloud Run
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'DoorKnocker Address Verification WebSocket Server',
            timestamp: new Date().toISOString()
        }));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

// =============================================================================
// WEBSOCKET SERVER
// =============================================================================
const wss = new WebSocketServer({ server });

console.log(`WebSocket server starting on port ${PORT}`);

wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received:', data);

            // Validate required fields
            if (!data.zone_id) {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing zone_id' }));
                return;
            }

            if (!POSTGRID_API_KEY) {
                ws.send(JSON.stringify({ status: 'error', message: 'Server misconfiguration: POSTGRID_API_KEY not set.' }));
                return;
            }

            if (!SUPABASE_SERVICE_ROLE_KEY) {
                ws.send(JSON.stringify({ status: 'error', message: 'Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY not set.' }));
                return;
            }

            const showOnlyVerified = data.showOnlyVerified !== undefined ? data.showOnlyVerified : false;

            await verifyAddresses(ws, data.zone_id, POSTGRID_API_KEY, SUPABASE_SERVICE_ROLE_KEY, showOnlyVerified);
        } catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({ status: 'error', message: 'Invalid JSON or server error' }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// =============================================================================
// ADDRESS VERIFICATION LOGIC
// =============================================================================

function parseAddress(formattedAddress) {
    const withoutCountry = formattedAddress.replace(/, (USA|US|United States)$/i, '').trim();
    const parts = withoutCountry.split(',').map(p => p.trim());

    if (parts.length >= 3) {
        return {
            line1: parts[0],
            city: parts[1],
            provinceOrState: parts[2].split(' ')[0],
            postalOrZip: parts[2].split(' ').slice(1).join(' '),
            country: 'US'
        };
    } else if (parts.length === 2) {
        // Handle "123 Main St, City State Zip" or "123 Main St, City"
        const secondPart = parts[1].trim();
        const secondPartSplit = secondPart.split(' ');
        
        // If second part has spaces and looks like "City State Zip"
        if (secondPartSplit.length >= 2) {
             const zip = secondPartSplit[secondPartSplit.length - 1];
             const state = secondPartSplit[secondPartSplit.length - 2];
             // Simple heuristic: zip is usually numeric, state is 2 chars
             
             const cityWords = secondPartSplit.slice(0, -2);
             const city = cityWords.length > 0 ? cityWords.join(' ') : parts[1]; // Fallback if slice is empty
             
             return {
                line1: parts[0],
                city: city, 
                provinceOrState: state,
                postalOrZip: zip,
                country: 'US'
            };
        } else {
             // Fallback for strict "City" only
             const cityStateZip = parts[1].split(' ');
             return {
                line1: parts[0],
                city: cityStateZip.slice(0, -2).join(' '),
                provinceOrState: cityStateZip[cityStateZip.length - 2],
                postalOrZip: cityStateZip[cityStateZip.length - 1],
                country: 'US'
            };
        }
    }

    return {
        line1: formattedAddress,
        city: '',
        provinceOrState: '',
        postalOrZip: '',
        country: 'US'
    };
}

async function verifyAddress(address, apiKey) {
    try {
        const addressComponents = parseAddress(address.address);
        console.log(`Verifying address: ${address.address}`);

        const response = await fetch(VERIFICATION_API_URL, {
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ address: addressComponents })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Verification failed for address: ${address.address}`, {
                status: response.status,
                error: errorText
            });
            return {
                ...address,
                verified: false,
                status: 'Unverified',
                verification_details: {
                    error: `API error: ${response.statusText}`,
                    status_code: response.status,
                    details: errorText
                },
                api_response: { error: errorText, status: response.status }
            };
        }

        const result = await response.json();
        const data = result.data;
        // Accept both 'verified' and 'corrected' as valid
        const verified = data.status === 'verified' || data.status === 'corrected';
        const verifiedAddress = `${data.line1}, ${data.city}, ${data.provinceOrState} ${data.postalOrZip}`;

        return {
            ...address,
            original_address: address.address, // Keep original for reference
            address: verifiedAddress,
            verified,
            status: verified ? 'Valid' : 'Unverified',
            verification_details: {
                status: data.status,
                line1: data.line1,
                city: data.city,
                provinceOrState: data.provinceOrState,
                postalOrZip: data.postalOrZip,
                details: data
            },
            api_response: data
        };

    } catch (error) {
        console.error('Error verifying address:', error);
        return {
            ...address,
            verified: false,
            status: 'Unverified',
            verification_details: { error: error.message },
            api_response: { error: error.message }
        };
    }
}

async function verifyAddresses(ws, zoneId, apiKey, supabaseAnonKey, showOnlyVerified) {
    const startTime = Date.now();

    try {
        ws.send(JSON.stringify({ status: 'started', message: 'Fetching zone data...', zone_id: zoneId }));

        const response = await fetch(`${SUPABASE_URL}/rest/v1/location_zones?id=eq.${zoneId}&select=*`, {
            method: 'GET',
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error(`Failed to fetch zone: ${response.statusText}`);

        const zones = await response.json();
        if (!zones || zones.length === 0) throw new Error('Zone not found');

        const zone = zones[0];
        const addresses = zone.addresses || [];

        const verifiedAddresses = [];
        let verifiedCount = 0;

        if (isTestMode) {
            const unverifiedCount = addresses.filter(addr => addr.verified !== true).length;
            const testCount = unverifiedCount > 0 ? unverifiedCount : addresses.length || 20;
            console.log(`Test Mode: ${unverifiedCount} unverified addresses found, generating ${testCount} test addresses`);
            verifiedAddresses.push(...getTestAddresses(testCount));
            verifiedCount = verifiedAddresses.filter(addr => addr.verified === true).length;
            
            ws.send(JSON.stringify({
                status: 'processing',
                message: `Test mode: Using ${verifiedCount} hardcoded addresses.`,
                total_addresses: verifiedCount,
                verified_count: verifiedCount,
                processed_count: verifiedCount
            }));
        } else {
            if (addresses.length === 0) {
                ws.send(JSON.stringify({ status: 'error', message: 'Zone has no addresses to verify' }));
                return;
            }

            if (addresses.length > 10000) {
                ws.send(JSON.stringify({ status: 'error', message: 'Cannot verify more than 10,000 addresses at once' }));
                return;
            }

            console.log(`Starting processing for ${addresses.length} addresses in zone ${zoneId}`);
            ws.send(JSON.stringify({
                status: 'processing',
                message: `Found ${addresses.length} addresses to process`,
                total_addresses: addresses.length,
                verified_count: 0,
                processed_count: 0
            }));

            const BATCH_SIZE = 20;
            let processedCount = 0;

            for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
                const batch = addresses.slice(i, i + BATCH_SIZE);
                const batchPromises = batch.map(addr => verifyAddress(addr, apiKey));
                const batchResults = await Promise.all(batchPromises);
                verifiedAddresses.push(...batchResults);

                processedCount += batchResults.length;
                verifiedCount = verifiedAddresses.filter(addr => addr.verified === true).length;

                ws.send(JSON.stringify({
                    status: 'processing',
                    message: `Processed ${processedCount} of ${addresses.length} addresses`,
                    total_addresses: addresses.length,
                    verified_count: verifiedCount,
                    unverified_count: processedCount - verifiedCount,
                    processed_count: processedCount,
                    progress_percentage: Math.round((processedCount / addresses.length) * 100)
                }));

                if (i + BATCH_SIZE < addresses.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }

        const unverifiedCount = verifiedAddresses.length - verifiedCount;
        const processingTimeMs = Date.now() - startTime;

        console.log(`Processing complete: ${verifiedCount} verified, ${unverifiedCount} unverified`);
        ws.send(JSON.stringify({ status: 'processing', message: 'Updating zone with processed addresses...' }));

        const updateResponse = await fetch(`${SUPABASE_URL}/rest/v1/location_zones?id=eq.${zoneId}`, {
            method: 'PATCH',
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ addresses: verifiedAddresses, updated_at: new Date().toISOString() })
        });

        if (!updateResponse.ok) console.error(`Error updating zone with verified addresses: ${updateResponse.statusText}`);

        const addressesToReturn = showOnlyVerified
            ? verifiedAddresses.filter(addr => addr.verified === true)
            : verifiedAddresses;

        ws.send(JSON.stringify({
            status: 'success',
            message: showOnlyVerified
                ? `Returning ${addressesToReturn.length} verified addresses`
                : `Verified ${verifiedCount} of ${addresses.length} addresses`,
            center: zone.center,
            mode: zone.mode,
            searchType: zone.search_type,
            metadata: {
                ...zone.metadata,
                verified_count: verifiedCount,
                unverified_count: unverifiedCount,
                total_addresses: addresses.length,
                returned_addresses: addressesToReturn.length,
                showing_only_verified: showOnlyVerified,
                processingTimeMs
            },
            addresses: addressesToReturn
        }));

    } catch (error) {
        console.error('Address verification failed:', error);
        ws.send(JSON.stringify({ status: 'error', message: error.message }));
    }
}

// =============================================================================
// START SERVER
// =============================================================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} with WebSocket support`);
});
