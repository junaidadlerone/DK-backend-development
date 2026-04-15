import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import http from 'http';
import process from 'node:process';

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

function getTestAddresses(count, _originalRows = []) {
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

/**
 * Newly added helper for CSV Address List test mode.
 * Preserves the original address details and IDs but injects mock verification results.
 */
function getCSVTestAddresses(originalRows) {
  const addresses = [];

  for (let i = 0; i < originalRows.length; i++) {
    const row = originalRows[i];
    
    // Simulate API response with high probability of success (90% success)
    const isSuccess = Math.random() > 0.07; 
    const status = isSuccess ? 'Valid' : 'Unverified';
    const verified = isSuccess;

    addresses.push({
      ...row,
      // Do NOT scramble coordinates - use existing ones or default if missing
      lat: row.lat || 33.4942, 
      long: row.long || -111.9260,
      status: status,
      verified: verified,
      is_included: true,
      is_valid: verified,
      verification_details: {
        status: isSuccess ? 'verified' : 'unverified',
        line1: row.address_line1 || 'Mock Line 1',
        city: row.city || 'Scottsdale',
        provinceOrState: row.state || 'AZ',
        postalOrZip: row.zip || '85251',
        details: {
             status: isSuccess ? 'verified' : 'unverified',
             line1: row.address_line1,
             city: row.city,
             provinceOrState: row.state,
             postalOrZip: row.zip
        }
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

            const showOnlyVerified = data.showOnlyVerified !== undefined ? data.showOnlyVerified : false;

            if (data.csv_address_list_id) {
                await verifyCSVAddresses(ws, data.csv_address_list_id, POSTGRID_API_KEY, SUPABASE_SERVICE_ROLE_KEY, showOnlyVerified);
            } else if (data.zone_id) {
                await verifyZoneAddresses(ws, data.zone_id, POSTGRID_API_KEY, SUPABASE_SERVICE_ROLE_KEY, showOnlyVerified);
            } else {
                 ws.send(JSON.stringify({ status: 'error', message: 'Neither zone_id nor csv_address_list_id provided' }));
            }
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
// HELPER FUNCTIONS - CSV ADDRESS VERIFICATION
// =============================================================================

/**
 * Extracts the skip_verification flag from the CSV address list record.
 * Returns true if verification should be skipped, false otherwise.
 */
function getSkipVerificationFlag(record) {
    return record.skip_address_verification === true || false;
}

/**
 * Maps PostGrid API status response to is_reachable boolean.
 * Based on the status field from PostGrid verification response.
 */
function mapPostgridStatusToReachability(postgridStatus) {
    if (!postgridStatus) return false;
    const reachableStatuses = ['verified', 'corrected'];
    return reachableStatuses.includes(postgridStatus.toLowerCase());
}

/**
 * Determines if an address is verified based on PostGrid status.
 */
function isAddressVerified(postgridStatus) {
    if (!postgridStatus) return false;
    return postgridStatus.toLowerCase() === 'verified' || postgridStatus.toLowerCase() === 'corrected';
}

/**
 * Enriches a CSV address with reachability information based on PostGrid response.
 */
function enrichCSVAddressWithReachability(address, postgridStatus) {
    const isReachable = mapPostgridStatusToReachability(postgridStatus);
    return {
        ...address,
        is_reachable: isReachable,
        verified: isAddressVerified(postgridStatus),
        status: isAddressVerified(postgridStatus) ? 'Valid' : 'Unverified'
    };
}

/**
 * Enriches a zone address with reachability information based on PostGrid response.
 */
function enrichZoneAddressWithReachability(address, postgridData) {
    const postgridStatus = postgridData.status;
    const isReachable = mapPostgridStatusToReachability(postgridStatus);
    const verified = isAddressVerified(postgridStatus);

    const verifiedAddress = `${postgridData.line1}, ${postgridData.city}, ${postgridData.provinceOrState} ${postgridData.postalOrZip}`;

    return {
        ...address,
        original_address: address.address,
        address: verifiedAddress,
        is_reachable: isReachable,
        verified,
        status: verified ? 'Valid' : 'Unverified',
        verification_details: {
            status: postgridStatus,
            line1: postgridData.line1,
            city: postgridData.city,
            provinceOrState: postgridData.provinceOrState,
            postalOrZip: postgridData.postalOrZip,
            details: postgridData
        },
        api_response: postgridData
    };
}

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
        const addressText = address.address || 
            `${address.address_line1 || ''}, ${address.city || ''}, ${address.state || ''} ${address.zip || ''}`.trim().replace(/^,|,$/g, '');
        
        const addressComponents = parseAddress(addressText);
        console.log(`Verifying address: ${addressText}`);

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
        const postgridStatus = data.status;
        const isCsv = address.address_line1 !== undefined;

        if (isCsv) {
            return {
                ...enrichCSVAddressWithReachability(address, postgridStatus),
                verification_details: {
                    ...(address.verification_details || {}),
                    status: postgridStatus,
                    details: data
                }
            };
        } else {
            return enrichZoneAddressWithReachability(address, data);
        }

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

async function verifyZoneAddresses(ws, zone_id, apiKey, supabaseAnonKey, showOnlyVerified) {
    const startTime = Date.now();
    try {
        const table = 'location_zones';
        const fetchUrl = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${zone_id}&select=*`;
        ws.send(JSON.stringify({ status: 'started', message: 'Fetching zone data...', zone_id }));

        const response = await fetch(fetchUrl, {
            method: 'GET',
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error(`Failed to fetch data: ${response.statusText}`);

        const results = await response.json();
        if (!results || results.length === 0) throw new Error(`Record not found in ${table}`);

        const record = results[0];
        const addresses = record.addresses || [];

        const verifiedAddresses = [];
        let verifiedCount = 0;

        if (isTestMode) {
            const unverifiedCount = addresses.filter(addr => addr.verified !== true).length;
            const testCount = unverifiedCount > 0 ? unverifiedCount : addresses.length || 20;
            console.log(`Test Mode (Zone): Generating ${testCount} hardcoded SF addresses`);
            const mocks = getTestAddresses(testCount);

            // Enrich test addresses with is_reachable flag
            const enrichedMocks = mocks.map(addr => ({
                ...addr,
                is_reachable: addr.verified === true
            }));

            verifiedAddresses.push(...enrichedMocks);
            verifiedCount = verifiedAddresses.filter(addr => addr.verified === true).length;

            ws.send(JSON.stringify({
                status: 'processing',
                message: `Test mode: Generated mock SF addresses with reachability flags`,
                total_addresses: enrichedMocks.length,
                verified_count: verifiedCount,
                processed_count: enrichedMocks.length
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

            console.log(`Starting processing for ${addresses.length} addresses in ${table} ${zone_id}`);
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
        ws.send(JSON.stringify({ status: 'processing', message: `Updating ${table} with processed addresses...` }));

        const updateResponse = await fetch(fetchUrl, {
            method: 'PATCH',
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ 
                addresses: verifiedAddresses, 
                updated_at: new Date().toISOString() 
            })
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
            center: record.center || null,
            mode: record.mode || null,
            searchType: record.search_type || null,
            metadata: {
                ...(record.metadata || {}),
                verified_count: verifiedCount,
                unverified_count: unverifiedCount,
                total_addresses: addresses.length,
                returned_addresses: addressesToReturn.length,
                reachable_count: verifiedAddresses.filter(addr => addr.is_reachable === true).length,
                showing_only_verified: showOnlyVerified,
                processingTimeMs
            },
            addresses: addressesToReturn
        }));

    } catch (error) {
        console.error('Zone verification failed:', error);
        ws.send(JSON.stringify({ status: 'error', message: error.message }));
    }
}

async function verifyCSVAddresses(ws, list_id, apiKey, supabaseAnonKey, showOnlyVerified) {
    const startTime = Date.now();
    try {
        const table = 'campaign_csv_address_lists';
        const fetchUrl = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${list_id}&select=*`;
        ws.send(JSON.stringify({ status: 'started', message: 'Fetching CSV address list...', csv_address_list_id: list_id }));

        const response = await fetch(fetchUrl, {
            method: 'GET',
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) throw new Error(`Failed to fetch data: ${response.statusText}`);

        const results = await response.json();
        if (!results || results.length === 0) throw new Error(`Record not found in ${table}`);

        const record = results[0];
        const allAddresses = record.addresses || [];

        // Use validated_address_list (already filtered) for processing, fallback to filtered addresses
        const addresses = (record.validated_address_list && record.validated_address_list.length > 0)
            ? record.validated_address_list
            : allAddresses.filter(addr => !addr.is_deleted);

        // Extract skip_verification flag from record
        const skipVerification = getSkipVerificationFlag(record);
        console.log(`Skip verification flag: ${skipVerification}`);

        const verifiedAddresses = [];
        let verifiedCount = 0;

        if (isTestMode) {
            console.log(`Test Mode (CSV): Enriching ${addresses.length} original addresses`);
            const mocks = getCSVTestAddresses(addresses);

            // Enrich test addresses with is_reachable flag
            const enrichedMocks = mocks.map(addr => ({
                ...addr,
                is_reachable: addr.verified === true
            }));

            verifiedAddresses.push(...enrichedMocks);
            verifiedCount = verifiedAddresses.filter(addr => addr.verified === true).length;

            ws.send(JSON.stringify({
                status: 'processing',
                message: `Test mode: Enriched original rows with reachability flags`,
                total_addresses: enrichedMocks.length,
                verified_count: verifiedCount,
                processed_count: enrichedMocks.length
            }));
        } else {
            if (addresses.length === 0) {
                ws.send(JSON.stringify({ status: 'error', message: 'List has no addresses to verify' }));
                return;
            }

            console.log(`Starting processing for ${addresses.length} addresses in ${table} ${list_id}`);
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
        console.log(`Setting skip_address_verification to FALSE (verification was executed)`);
        ws.send(JSON.stringify({ status: 'processing', message: `Updating ${table} with processed addresses...` }));

        const updateResponse = await fetch(fetchUrl, {
            method: 'PATCH',
            headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                addresses: verifiedAddresses,
                validated_address_list: verifiedAddresses,
                skip_address_verification: false,
                updated_at: new Date().toISOString()
            })
        });

        if (!updateResponse.ok) console.error(`Error updating list with verified addresses: ${updateResponse.statusText}`);

        const addressesToReturn = showOnlyVerified
            ? verifiedAddresses.filter(addr => addr.verified === true)
            : verifiedAddresses;

        ws.send(JSON.stringify({
            status: 'success',
            message: showOnlyVerified
                ? `Returning ${addressesToReturn.length} verified addresses`
                : `Verified ${verifiedCount} of ${addresses.length} addresses`,
            center: record.center || null,
            mode: null,
            searchType: null,
            metadata: {
                ...(record.metadata || {}),
                skip_verification: false,
                verified_count: verifiedCount,
                unverified_count: unverifiedCount,
                total_addresses: addresses.length,
                returned_addresses: addressesToReturn.length,
                reachable_count: verifiedAddresses.filter(addr => addr.is_reachable === true).length,
                showing_only_verified: showOnlyVerified,
                processingTimeMs
            },
            addresses: addressesToReturn
        }));

    } catch (error) {
        console.error('CSV verification failed:', error);
        ws.send(JSON.stringify({ status: 'error', message: error.message }));
    }
}

// =============================================================================
// START SERVER
// =============================================================================
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT} with WebSocket support`);
});
