const functions = require('@google-cloud/functions-framework');
const { WebSocketServer } = require('ws');
const fetch = require('node-fetch');
const http = require('http');

// =============================================================================
// CONFIGURATION - API KEYS & URLS
// =============================================================================
const PORT = process.env.PORT || 8080;

const SUPABASE_URL = 'https://iywivotqnphrjijztxtu.supabase.co/functions/v1';
const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const POSTGRID_API_KEY = process.env.POSTGRID_POSTCARD_API_KEY;
const POSTGRID_URL = 'https://api.postgrid.com/print-mail/v1/postcards';

// =============================================================================
// HTTP SERVER WITH WEBSOCKET SUPPORT
// =============================================================================
const server = http.createServer((req, res) =>
{
    // Health check endpoint for Cloud Run
    if (req.url === '/' && req.method === 'GET')
    {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            service: 'DoorKnocker WebSocket Server',
            timestamp: new Date().toISOString()
        }));
    } else
    {
        res.writeHead(404);
        res.end();
    }
});

// =============================================================================
// WEBSOCKET SERVER
// =============================================================================
const wss = new WebSocketServer({ server });

console.log(`WebSocket server starting on port ${PORT}`);

wss.on('connection', (ws) =>
{
    console.log('Client connected');

    ws.on('message', async (message) =>
    {
        try
        {
            const data = JSON.parse(message);
            console.log('Received:', data);

            // Validate required fields
            if (!data.campaign_id)
            {
                ws.send(JSON.stringify({ status: 'error', message: 'Missing campaign_id' }));
                return;
            }

            if (!POSTGRID_API_KEY)
            {
                ws.send(JSON.stringify({
                    status: 'error',
                    message: 'Server misconfiguration: POSTGRID_POSTCARD_API_KEY not set.'
                }));
                return;
            }

            await processCampaign(ws, data.campaign_id, POSTGRID_API_KEY);
        } catch (error)
        {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({ status: 'error', message: 'Invalid JSON or server error' }));
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

// =============================================================================
// CAMPAIGN PROCESSING LOGIC
// =============================================================================
async function processCampaign(ws, campaignId, postgridApiKey)
{
    let count = 0;
    ws.send(JSON.stringify({ status: 'processing_started', campaign_id: campaignId }));

    try
    {
        // 1. Change Campaign Status
        console.log(`Changing status for campaign: ${campaignId}`);
        const changeStatusResponse = await fetch(`${SUPABASE_URL}/changeCampaignStatus`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ campaign_id: campaignId })
        });

        if (!changeStatusResponse.ok)
        {
            console.error(`Failed to change campaign status: ${changeStatusResponse.statusText}`);
            // Continue processing even if status change fails
        } else
        {
            console.log('Campaign status changed successfully');
        }

        // 2. Fetch Campaign Launch Data
        console.log(`Fetching data for campaign: ${campaignId}`);
        const launchDataResponse = await fetch(`${SUPABASE_URL}/getCampaignLaunchData`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ campaign_id: campaignId })
        });

        if (!launchDataResponse.ok)
        {
            throw new Error(`Failed to fetch campaign data: ${launchDataResponse.statusText}`);
        }

        const campaignData = await launchDataResponse.json();

        if (campaignData.status !== 'success' || !campaignData.launch_data)
        {
            throw new Error('Invalid campaign data structure received from Supabase');
        }

        const { launch_data, campaign_templates, business_data, offer_data } = campaignData;

        const allAddresses = launch_data.verified_addresses || [];
        const isCsvCampaign = !!launch_data.csv_address_list_id;
        const skipVerification = isCsvCampaign ? (launch_data.skip_verification || false) : false;

        console.log(`Campaign type: ${isCsvCampaign ? 'CSV' : 'Zone'}, Skip verification: ${skipVerification}`);

        const addresses = allAddresses.filter(addr => {
            if (addr.is_deleted === true) return false;
            if (addr.status === 'Opt-out' || addr.is_duplicate === true) return false;
            if (addr.is_valid !== true && addr.verified !== true) return false;
            if (isCsvCampaign) {
                return skipVerification ? true : addr.is_reachable === true;
            }
            return true;
        });

        console.log(`Found ${addresses.length} addresses to process (filtered out ${allAddresses.length - addresses.length} addresses).`);

        // Send progress update
        ws.send(JSON.stringify({
            status: 'processing',
            total_addresses: addresses.length,
            processed: 0
        }));

        // 3. Loop through addresses and send postcards
        const postcardRecords = [];

        for (let i = 0; i < addresses.length; i++)
        {
            const addr = addresses[i];
            try
            {
                const postcardId = await sendPostcard(addr, campaign_templates, business_data, offer_data, postgridApiKey);
                if (postcardId)
                {
                    count++;
                    postcardRecords.push({
                        postgrid_postcard_id: postcardId,
                        address: addr.address || addr.address_line1 || ''
                    });
                }

                // Send progress update every 5 addresses or on last address
                if ((i + 1) % 5 === 0 || i === addresses.length - 1)
                {
                    ws.send(JSON.stringify({
                        status: 'processing',
                        total_addresses: addresses.length,
                        processed: i + 1,
                        sent: count
                    }));
                }

            } catch (err)
            {
                console.error(`Failed to send postcard to ${addr.address}:`, err.message);
                // Continue loop even if one fails
            }
        }

        console.log(`Finished processing. Total sent: ${count}`);

        // 4. Store individual postcard records for analytics (before updating sent count)
        if (postcardRecords.length > 0)
        {
            await storePostcardSends(campaignId, postcardRecords);
        }

        // 5. Update PostCards Sent Count
        await updateSentCount(campaignId, count);

        ws.send(JSON.stringify({
            status: 'success',
            message: 'Campaign processing completed',
            processed_count: count,
            total_addresses: addresses.length
        }));

    } catch (error)
    {
        console.error('Campaign processing failed:', error);
        ws.send(JSON.stringify({ status: 'error', message: error.message }));
    }
}

// =============================================================================
// POSTGRID INTEGRATION
// =============================================================================
async function sendPostcard(addressObj, templates, businessData, offerData, postgridApiKey)
{
    // Map sizes according to PostGrid requirements
    const rawSize = templates.front_template_size || "4x6";
    const sizeMap = {
        "4x6": "6x4",
        "6x9": "9x6",
        "6x11": "11x6"
    };
    const size = sizeMap[rawSize] || "6x4";

    const addressLine1 = addressObj.address || addressObj.address_line1 || "";
    const city = addressObj.city || "";
    const state = addressObj.state || addressObj.provinceOrState || "";
    const zip = addressObj.zip || addressObj.postalOrZip || "";

    const payload = {
        to: {
            addressLine1: addressLine1,
            city: city,
            provinceOrState: state,
            postalOrZip: zip,
            firstName: addressObj.full_name || addressObj.first_name || "Current Resident",
            lastName: addressObj.last_name || "",
            countryCode: 'US'
        },
        size: size,
        frontTemplate: templates.front_template_id,
        backTemplate: templates.back_template_id,
        description: offerData.offer_headline || "Campaign Postcard",
        mergeVariables: {} // Will set below
    };

    // Construct mergeVariables explicitly
    // specific fields from businessData (excluding generic merge_variable object if present)
    const { merge_variable, ...restBusinessData } = businessData;
    
    const mergedVars = {
        ...offerData,
        ...restBusinessData,
        ...(merge_variable || {})
    };



    payload.mergeVariables = mergedVars;

    console.log(`Sending PostGrid Payload for ${addressObj.address}:`, JSON.stringify(payload, null, 2));

    const response = await fetch(POSTGRID_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': postgridApiKey  // Now using the dynamic API key
        },
        body: JSON.stringify(payload)
    });

    if (response.ok)
    {
        const json = await response.json();
        console.log(`PostGrid Success Response for ${addressObj.address}:`, JSON.stringify(json, null, 2));
        console.log(`Postcard sent to ${addressObj.address}. ID: ${json.id}`);
        return json.id || null;  // return PostGrid postcard ID (e.g. "postcard_xxx")
    } else
    {
        const errorText = await response.text();
        console.error(`PostGrid Error (${response.status}) for ${addressObj.address}:`, errorText);
        return null;
    }
}

// =============================================================================
// SUPABASE UPDATE
// =============================================================================
async function storePostcardSends(campaignId, postcards)
{
    try
    {
        const response = await fetch(`${SUPABASE_URL}/storePostcardSends`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ campaign_id: campaignId, postcards: postcards })
        });

        if (!response.ok)
        {
            console.error(`Failed to store postcard sends: ${response.statusText}`);
        } else
        {
            console.log(`Stored ${postcards.length} postcard records for campaign ${campaignId}`);
        }
    } catch (err)
    {
        // Non-fatal — analytics data loss is preferable to breaking the campaign send
        console.error(`Failed to store postcard sends for campaign ${campaignId}:`, err.message);
    }
}

async function updateSentCount(campaignId, count)
{
    const response = await fetch(`${SUPABASE_URL}/updatePostCardsSentCount`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
            campaign_id: campaignId,
            count: count
        })
    });

    if (!response.ok)
    {
        console.error(`Failed to update sent count in Supabase: ${response.statusText}`);
    } else
    {
        console.log(`Updated Supabase count to ${count}`);
    }
}

// =============================================================================
// START SERVER
// =============================================================================
server.listen(PORT, () =>
{
    console.log(`Server listening on port ${PORT} with WebSocket support`);
});