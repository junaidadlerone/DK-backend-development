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

const SUPABASE_REST_URL = SUPABASE_URL.replace('/functions/v1', '/rest/v1');

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

            await processCampaign(ws, data.campaign_id, POSTGRID_API_KEY, data.paper);
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
// PAPER TYPE RESOLUTION
// =============================================================================
let _premiumPaperId = null;

async function resolvePaperType(paperInput, apiKey) {
    if (!paperInput || paperInput === 'standard') return 'standard';
    if (!_premiumPaperId) {
        const res = await fetch('https://api.postgrid.com/print-mail/v1/premium_papers', {
            headers: { 'x-api-key': apiKey }
        });
        if (!res.ok) throw new Error(`Failed to fetch premium papers: ${res.status}`);
        const data = await res.json();
        _premiumPaperId = data.data?.find(p => p.id !== 'standard')?.id;
        if (!_premiumPaperId) throw new Error('No premium papers available from PostGrid');
        console.log(`[paper] Resolved premium paper ID: ${_premiumPaperId}`);
    }
    return _premiumPaperId;
}

// =============================================================================
// CAMPAIGN PROCESSING LOGIC
// =============================================================================
async function savePaperType(campaignId, paperType) {
    try {
        const res = await fetch(`${SUPABASE_REST_URL}/campaigns?id=eq.${campaignId}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ paper_type: paperType })
        });
        if (!res.ok) {
            console.error(`[paper] savePaperType failed: HTTP ${res.status} — ${await res.text()}`);
        } else {
            console.log(`[paper] paper_type saved as '${paperType}' for campaign ${campaignId}`);
        }
    } catch (err) {
        console.error('[paper] savePaperType error:', err.message);
    }
}

async function processCampaign(ws, campaignId, postgridApiKey, paperInput)
{
    const paper = await resolvePaperType(paperInput, postgridApiKey);
    const paperType = paper === 'standard' ? 'standard' : 'premium';
    savePaperType(campaignId, paperType);
    let count = 0;
    ws.send(JSON.stringify({ status: 'processing_started', campaign_id: campaignId }));

    try
    {
        // 1. Change Campaign Status
        console.log(`Changing status for campaign: ${campaignId}`);
        await changeCampaignStatus(campaignId);

        // 2. Fetch Campaign Launch Data
        console.log(`Fetching data for campaign: ${campaignId}`);
        const campaignData = await getCampaignLaunchData(campaignId);

        const { launch_data, campaign_templates, business_data, offer_data } = campaignData;
        const {
            template_bundle_id,
            front_template_id,
            back_template_id,
            postgrid_tracker_id
        } = campaign_templates;

        // Extract tracker ID from database OR fallback to qr_url in business_data
        let resolvedTrackerId = postgrid_tracker_id;
        if (!resolvedTrackerId && business_data.qr_url && typeof business_data.qr_url === 'string') {
            const parts = business_data.qr_url.split('.');
            if (parts[0].startsWith('tracker_')) {
                resolvedTrackerId = parts[0];
                console.log(`[QR-DEBUG] Root Fallback: Extracted trackerId from businessData.qr_url: ${resolvedTrackerId}`);
            }
        }

        // 2b. Fetch Template HTML separately and Update (Pre-mailing)
        let originalFrontHtml = null;
        let originalBackHtml = null;
        let finalFrontHtml = null;
        let finalBackHtml = null;
        let originalFrontQrUrl = null;
        let originalBackQrUrl = null;

        if (template_bundle_id && resolvedTrackerId) {
            const [frontTemplate, backTemplate] = await Promise.all([
                getTemplateById(front_template_id),
                getTemplateById(back_template_id)
            ]);

            originalFrontHtml = frontTemplate.html;
            originalBackHtml = backTemplate.html;

            const qrRegex = /<img[^>]*src=\\?["']https:\/\/api\.qrserver\.com\/v1\/create-qr-code\/[^"']+data=[^"& \s]+[^"']*\\?["'][^>]*>/gi;

            const replaceQrSrc = (html, label, trackerId, urlSetter) => {
                if (!html) return html;

                const newHtml = html.replace(qrRegex, (match) => {
                    // Extract original URL before replacing
                    const urlMatch = match.match(/src=\\?["']([^"']+)["']/);
                    if (urlMatch && urlMatch[1]) {
                        urlSetter(urlMatch[1]);
                    }

                    const replaced = match.replace(/src=\\?["'][^"']+\\?["']/, (srcMatch) => {
                        const quote = srcMatch.startsWith('src=\\"') ? '\\"' : '"';
                        return `src=${quote}{{${trackerId}.qrcode}}${quote}`;
                    });
                    return replaced;
                });

                return newHtml;
            };

            finalFrontHtml = replaceQrSrc(originalFrontHtml, "Front", resolvedTrackerId, (url) => originalFrontQrUrl = url);
            finalBackHtml = replaceQrSrc(originalBackHtml, "Back", resolvedTrackerId, (url) => originalBackQrUrl = url);

            if (finalFrontHtml !== originalFrontHtml || finalBackHtml !== originalBackHtml) {
                console.log("Updating bundle with native placeholders...");
                await updateTemplateBundle(template_bundle_id, finalFrontHtml, finalBackHtml);
            }
        }

        // Filter addresses based on campaign type and skip_verification flag
        const allAddresses = launch_data.verified_addresses || [];
        const isCsvCampaign = !!launch_data.csv_address_list_id;
        const skipVerification = isCsvCampaign ? (launch_data.skip_verification || false) : false;

        console.log(`Campaign type: ${isCsvCampaign ? 'CSV' : 'Zone'}, Skip verification: ${skipVerification}`);

        const addresses = allAddresses.filter(addr => {
            // Always exclude deleted addresses
            if (addr.is_deleted === true) {
                return false;
            }

            // Always exclude opt-outs and duplicates
            if (addr.status === 'Opt-out' || addr.is_duplicate === true) {
                return false;
            }

            // Always exclude invalid addresses
            if (addr.is_valid !== true && addr.verified !== true) {
                return false;
            }

            // For CSV campaigns: Apply reachability filter based on skip_verification flag
            if (isCsvCampaign) {
                if (skipVerification) {
                    // If skip_verification is TRUE: send to all valid addresses (regardless of reachability)
                    return true;
                } else {
                    // If skip_verification is FALSE: send only to reachable addresses
                    return addr.is_reachable === true;
                }
            }

            // For zone campaigns: Include all valid/verified addresses (no reachability check)
            return true;
        });

        const filteredCount = allAddresses.length - addresses.length;
        const filterReason = isCsvCampaign && !skipVerification
            ? `(filtered unreachable: ${allAddresses.filter(a => a.is_reachable !== true).length})`
            : `(filtered opt-outs/duplicates: ${filteredCount})`;

        console.log(`Found ${addresses.length} addresses to process out of ${allAddresses.length} ${filterReason}.`);

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
                const postcardId = await sendPostcard(addr, campaign_templates, business_data, offer_data, postgridApiKey, resolvedTrackerId, paper);
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
            total_addresses: addresses.length,
            campaign_type: isCsvCampaign ? 'CSV' : 'Zone',
            skip_verification: skipVerification,
            filtered_out: allAddresses.length - addresses.length,
            sent_successfully: count,
            failed_count: addresses.length - count
        }));

        // 5. Revert Templates (Test environment specific cleanup)
        if (template_bundle_id && resolvedTrackerId && (originalFrontQrUrl || originalBackQrUrl)) {
            try {
                console.log("Starting template reversion...");
                const trackerData = await getTracker(resolvedTrackerId, postgridApiKey);
                const redirectUrl = trackerData.redirectURLTemplate;

                if (redirectUrl) {
                    console.log(`Reverting trackers to redirect URL`);

                    const revertTemplate = (html, originalUrl) => {
                        if (!html || !originalUrl) return html;
                        // Replace {{tracker_XYZ.qrcode}} placeholders with the original URL,
                        // but swapping the data parameter for the real redirect URL.
                        const restoredUrl = originalUrl.replace(/(data=)[^"& \s]+/, `$1${encodeURIComponent(redirectUrl)}`);
                        return html.replace(/{{[^}]+.qrcode}}/g, restoredUrl);
                    };

                    const revertedFront = revertTemplate(finalFrontHtml || originalFrontHtml, originalFrontQrUrl);
                    const revertedBack = revertTemplate(finalBackHtml || originalBackHtml, originalBackQrUrl);

                    await updateTemplateBundle(template_bundle_id, revertedFront, revertedBack);
                    console.log("Template bundle reverted to baseline.");
                }
            } catch (revertError) {
                console.error("Failed to revert templates:", revertError.message);
            }
        }

    } catch (error)
    {
        console.error('Campaign processing failed:', error);
        ws.send(JSON.stringify({ status: 'error', message: error.message }));
    }
}

// =============================================================================
// POSTGRID INTEGRATION
// =============================================================================
async function sendPostcard(addressObj, templates, businessData, offerData, postgridApiKey, trackerId, paper)
{
    // Map sizes according to PostGrid requirements
    const rawSize = templates.front_template_size || "4x6";
    const sizeMap = {
        "4x6": "6x4",
        "6x9": "9x6",
        "6x11": "11x6"
    };
    const size = sizeMap[rawSize] || "6x4";

    // Construct mergeVariables explicitly
    // specific fields from businessData (excluding generic merge_variable object if present)
    const { merge_variable, ...restBusinessData } = businessData;

    console.log(`[QR-DEBUG] sendPostcard: Received trackerId from parent: ${trackerId}`);

    const mergedVars = {
        ...offerData,
        ...restBusinessData,
        ...(merge_variable || {}),
        tracker_id: trackerId // Use the pre-resolved trackerId
    };

    // Special handling for PostGrid QR codes: ensure they are wrapped in braces for resolution
    if (mergedVars.qr_url && typeof mergedVars.qr_url === 'string' && mergedVars.qr_url.includes('.qrcode')) {
        console.log(`[QR-DEBUG] Formatting legacy qr_url for merge: ${mergedVars.qr_url}`);
        mergedVars.qr_url = `{{${mergedVars.qr_url}}}`;
    }

    // Robust address mapping for both traditional and CSV-based addresses
    const addressLine1 = addressObj.address || addressObj.address_line1 || "";
    const city = addressObj.city || "";
    const state = addressObj.state || addressObj.provinceOrState || "";
    const zip = addressObj.zip || addressObj.postalOrZip || "";

    if (!addressLine1) {
        console.error(`[ERROR] Missing addressLine1 for recipient. Data:`, JSON.stringify(addressObj));
    }

    // Validate templates before sending
    if (!templates.front_template_id || !templates.back_template_id) {
        throw new Error(`Missing template IDs for campaign. Front: ${templates.front_template_id}, Back: ${templates.back_template_id}`);
    }

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
        paper: paper || 'standard',
        frontTemplate: templates.front_template_id,
        backTemplate: templates.back_template_id,
        description: offerData.offer_headline || "Campaign Postcard",
        trackers: trackerId ? [trackerId] : [], // Use resolved trackerId
        mergeVariables: mergedVars,
        color: true,
        //mailingClass: "first_class",        // "first_class" (default) or "standard_class" (slower, cheaper)
        express: true             // ⚠️ Use this instead if you want 2-3 day express — NOT together with standard_class
    };

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
        return json.id || null;  // return PostGrid postcard ID (e.g. "postcard_xxx")
    } else
    {
        const errorText = await response.text();
        console.error(`PostGrid Error (${response.status}) for ${addressObj.address}:`, errorText);
        return null;
    }
}

// =============================================================================
// API HELPERS
// =============================================================================
async function callEdgeFunction(name, method, body = null) {
    const url = `${SUPABASE_URL}/${name}`;
    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`${name} failed (${response.status}): ${error}`);
    }
    return await response.json();
}

async function changeCampaignStatus(campaignId) {
    return await callEdgeFunction('changeCampaignStatus', 'POST', { campaign_id: campaignId });
}

async function getCampaignLaunchData(campaignId) {
    const res = await callEdgeFunction('getCampaignLaunchData', 'POST', { campaign_id: campaignId });
    if (res.status !== 'success') throw new Error('Failed to fetch launch data');
    return res;
}

async function getTemplateById(templateId) {
    const res = await callEdgeFunction('getTemplateById', 'POST', { templateId: templateId });
    if (res.status !== 'success' || !res.template) {
        throw new Error(`getTemplateById failed: ${res.message || 'Template not found'}`);
    }
    return res.template;
}

async function updateTemplateBundle(bundleId, htmlFront, htmlBack) {
    return await callEdgeFunction('updateTemplateBundle', 'POST', {
        template_bundle_id: bundleId,
        html_front: htmlFront,
        html_back: htmlBack
    });
}

async function getTracker(trackerId, apiKey) {
    const url = `https://api.postgrid.com/print-mail/v1/trackers/${trackerId}`;
    const response = await fetch(url, {
        headers: {
            'x-api-key': apiKey
        }
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`getTracker failed (${response.status}): ${err}`);
    }

    return await response.json();
}

async function storePostcardSends(campaignId, postcards) {
    try
    {
        await callEdgeFunction('storePostcardSends', 'POST', {
            campaign_id: campaignId,
            postcards: postcards
        });
        console.log(`Stored ${postcards.length} postcard records for campaign ${campaignId}`);
    } catch (err)
    {
        // Non-fatal — analytics data loss is preferable to breaking the campaign send
        console.error(`Failed to store postcard sends for campaign ${campaignId}:`, err.message);
    }
}

async function updateSentCount(campaignId, count) {
    return await callEdgeFunction('updatePostCardsSentCount', 'POST', {
        campaign_id: campaignId,
        count: count
    });
}

// =============================================================================
// START SERVER
// =============================================================================
server.listen(PORT, () =>
{
    console.log(`Server listening on port ${PORT} with WebSocket support`);
});
