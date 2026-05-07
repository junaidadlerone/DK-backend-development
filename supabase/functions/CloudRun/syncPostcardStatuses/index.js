import http from 'http';
import fetch from 'node-fetch';

const PORT = process.env.PORT || 8080;

const SUPABASE_URL             = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POSTGRID_API_KEY          = process.env.POSTGRID_POSTCARD_API_KEY;
const SYNC_SECRET               = process.env.SYNC_SECRET; // optional bearer token guard

const POSTGRID_BASE_URL  = 'https://api.postgrid.com/print-mail/v1';
const TERMINAL_STATUSES  = ['completed', 'cancelled'];
const DELAY_BETWEEN_MS   = 5_000; // 5 s between PostGrid requests — well under rate limit

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Supabase REST helpers ─────────────────────────────────────────────────────

function supabaseHeaders() {
    return {
        'apikey':        SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type':  'application/json'
    };
}

async function fetchPendingPostcards() {
    const statuses = TERMINAL_STATUSES.map(s => `"${s}"`).join(',');
    const url = `${SUPABASE_URL}/rest/v1/postcard_sends`
        + `?postgrid_status=not.in.(${TERMINAL_STATUSES.join(',')})`
        + `&select=id,postgrid_postcard_id,postgrid_status,imb_status`
        + `&order=created_at.asc`;

    const res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status} — ${await res.text()}`);
    return res.json();
}

async function updatePostcard(id, payload) {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/postcard_sends?id=eq.${id}`,
        {
            method:  'PATCH',
            headers: { ...supabaseHeaders(), 'Prefer': 'return=minimal' },
            body:    JSON.stringify(payload)
        }
    );
    if (!res.ok) throw new Error(`DB update failed: ${res.status} — ${await res.text()}`);
}

// ── Core sync logic ───────────────────────────────────────────────────────────

async function runSync() {
    const rows = await fetchPendingPostcards();
    console.log(`[sync] ${rows.length} non-terminal postcards to check`);

    if (rows.length === 0) return { total: 0, updated: 0, errors: 0, skipped: 0, unchanged: 0 };

    let updated = 0, errors = 0, skipped = 0, unchanged = 0;
    const now = new Date().toISOString();

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        console.log(`[sync] [${i + 1}/${rows.length}] ${row.postgrid_postcard_id}`);

        try {
            const pgRes = await fetch(
                `${POSTGRID_BASE_URL}/postcards/${row.postgrid_postcard_id}`,
                { headers: { 'x-api-key': POSTGRID_API_KEY } }
            );

            if (pgRes.status === 404) {
                console.log(`  → 404 not found, skipping`);
                skipped++;
            } else if (pgRes.status === 429) {
                // With 5 s between requests this shouldn't happen, but log and continue
                console.warn(`  → 429 rate limited — skipping, will retry next run`);
                errors++;
            } else if (!pgRes.ok) {
                console.warn(`  → PostGrid ${pgRes.status}: ${await pgRes.text()}`);
                errors++;
            } else {
                const pgData = await pgRes.json();

                const newStatus    = pgData.status    ?? row.postgrid_status;
                const newImbStatus = pgData.imbStatus ?? null;

                const statusChanged    = newStatus    !== row.postgrid_status;
                const imbStatusChanged = newImbStatus !== row.imb_status;

                if (!statusChanged && !imbStatusChanged) {
                    console.log(`  → unchanged`);
                    unchanged++;
                } else {
                    const payload = { status_updated_at: now };
                    if (statusChanged)    payload.postgrid_status = newStatus;
                    if (imbStatusChanged) payload.imb_status      = newImbStatus;

                    await updatePostcard(row.id, payload);
                    updated++;

                    const parts = [];
                    if (statusChanged)    parts.push(`status: ${row.postgrid_status} → ${newStatus}`);
                    if (imbStatusChanged) parts.push(`imbStatus: ${row.imb_status ?? 'null'} → ${newImbStatus ?? 'null'}`);
                    console.log(`  → updated: ${parts.join(', ')}`);
                }
            }
        } catch (err) {
            console.error(`  → error: ${err.message}`);
            errors++;
        }

        // Pause between every request — avoids rate limits completely
        if (i < rows.length - 1) await sleep(DELAY_BETWEEN_MS);
    }

    return { total: rows.length, updated, errors, skipped, unchanged };
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
    if (req.url === '/' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', service: 'syncPostcardStatuses', timestamp: new Date().toISOString() }));
        return;
    }

    if (req.method === 'POST' && req.url === '/sync') {
        // Optional bearer-token guard (set SYNC_SECRET env var to enable)
        if (SYNC_SECRET) {
            const auth = req.headers['authorization'] ?? '';
            if (auth !== `Bearer ${SYNC_SECRET}`) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }
        }

        if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !POSTGRID_API_KEY) {
            console.error('[sync] Missing required environment variables');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Missing environment variables' }));
            return;
        }

        console.log('[sync] Triggered');
        try {
            const result = await runSync();
            console.log('[sync] Complete:', result);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, ...result }));
        } catch (err) {
            console.error('[sync] Fatal error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`syncPostcardStatuses service running on port ${PORT}`);
    console.log(`POST /sync to trigger — 5 s delay between PostGrid requests`);
});

process.on('SIGTERM', () => {
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
