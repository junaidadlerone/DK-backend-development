#!/usr/bin/env node
'use strict';

const WebSocket = require('ws');
const https     = require('https');
const fs        = require('fs');
const path      = require('path');
const readline  = require('readline');

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://xnflihspegizweqidvow.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuZmxpaHNwZWdpendlcWlkdm93Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MjY0NDIsImV4cCI6MjA4NjUwMjQ0Mn0.7L8OiS4qzDzTSprhXthnnMdWgPltqYopYzYHNUp_6a0';
const WS_URL            = 'wss://findadresses-test-331293375800.europe-west1.run.app';
const RADIUS_METERS     = 160;   // 0.1 miles / 0.16 km
const CSV_DIR           = path.resolve(__dirname, '../docs/addresses');
const TIMEOUT_MS        = 90_000; // 90s per address
const DELAY_BETWEEN_MS  = 1_000;  // 1s pause between requests

// ── HTTP helper ───────────────────────────────────────────────────────────────
function post(url, body, extraHeaders = {}) {
    return new Promise((resolve, reject) => {
        const u    = new URL(url);
        const data = JSON.stringify(body);
        const req  = https.request({
            hostname: u.hostname,
            path:     u.pathname + u.search,
            method:   'POST',
            headers:  {
                'Content-Type':   'application/json',
                'Content-Length': Buffer.byteLength(data),
                ...extraHeaders
            }
        }, res => {
            let raw = '';
            res.on('data', c  => raw += c);
            res.on('end',  () => {
                try   { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch { resolve({ status: res.statusCode, body: raw }); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(filePath) {
    const lines   = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());

    return lines.slice(1).map(line => {
        const values = [];
        let cur = '', inQ = false;
        for (const ch of line) {
            if (ch === '"')              { inQ = !inQ; continue; }
            if (ch === ',' && !inQ)      { values.push(cur.trim()); cur = ''; continue; }
            cur += ch;
        }
        values.push(cur.trim());
        const row = {};
        headers.forEach((h, i) => row[h] = (values[i] || '').replace(/"/g, '').trim());
        return row;
    });
}

// ── Build address string from CSV row ─────────────────────────────────────────
function buildAddress(row) {
    const num   = row.street_number?.trim();
    const unit  = row.unit?.trim();
    const name  = row.street_name?.trim();
    const city  = row.city?.trim();
    const state = row.state_code?.trim();
    const zip   = row.zip_code?.trim();

    if (!num && !name) return null;

    const line1    = [num, name].filter(Boolean).join(' ') + (unit ? ` ${unit}` : '');
    const stateZip = [state, zip].filter(Boolean).join(' ');
    return [line1, city, stateZip].filter(Boolean).join(', ');
}

// ── WebSocket call ─────────────────────────────────────────────────────────────
function findAddresses(address, token) {
    return new Promise(resolve => {
        let done = false;
        const finish = result => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { ws.terminate(); } catch {}
            resolve(result);
        };

        const timer = setTimeout(
            () => finish({ success: false, error: 'TIMEOUT', addresses: [], zone_id: null }),
            TIMEOUT_MS
        );

        const ws = new WebSocket(WS_URL);

        ws.on('message', raw => {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }

            // Server sends { status: 'connected' } on open
            if (msg.status === 'connected') {
                ws.send(JSON.stringify({
                    type:    'getAddressesFromZone',
                    address,
                    data:    { radius: RADIUS_METERS },
                    headers: { authorization: `Bearer ${token}` }
                }));
            }

            if (msg.type === 'complete') {
                if (msg.status === 'success') {
                    finish({
                        success:   true,
                        error:     null,
                        addresses: msg.addresses || [],
                        zone_id:   msg.zone_id   || null
                    });
                } else {
                    finish({
                        success:   false,
                        error:     msg.error || msg.message || 'UNKNOWN',
                        addresses: [],
                        zone_id:   null
                    });
                }
            }
        });

        ws.on('error', err => finish({ success: false, error: err.message, addresses: [], zone_id: null }));
    });
}

// ── CLI prompt ─────────────────────────────────────────────────────────────────
function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n=== Find-Addresses CSV Test ===\n');

    // 1. Login
    process.stdout.write('Logging in ... ');
    const loginRes = await post(
        `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
        { email: 'admin@example.com', password: 'SecurePass123!' },
        { apikey: SUPABASE_ANON_KEY }
    );

    if (!loginRes.body?.access_token) {
        console.error('\nLogin failed:', JSON.stringify(loginRes.body, null, 2));
        process.exit(1);
    }
    const token = loginRes.body.access_token;
    console.log('OK\n');

    // 2. Pick CSV
    const csvFiles = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv')).sort();
    if (!csvFiles.length) { console.error('No CSV files found in', CSV_DIR); process.exit(1); }

    console.log('Available files:');
    csvFiles.forEach((f, i) => {
        const rows = fs.readFileSync(path.join(CSV_DIR, f), 'utf8').trim().split('\n').length - 1;
        console.log(`  ${i + 1}. ${f}  (${rows} rows)`);
    });

    const choice = await ask('\nEnter number: ');
    const idx    = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= csvFiles.length) {
        console.error('Invalid selection.'); process.exit(1);
    }

    const csvFile = csvFiles[idx];
    const csvPath = path.join(CSV_DIR, csvFile);
    const rows    = parseCSV(csvPath);
    console.log(`\nLoaded ${rows.length} rows from ${csvFile}`);
    console.log(`Estimated time: ~${Math.ceil(rows.length * 8 / 60)} minutes\n`);

    // 3. Process each address sequentially
    const results = [];
    let successCount = 0, failureCount = 0, skippedCount = 0;

    for (let i = 0; i < rows.length; i++) {
        const row     = rows[i];
        const address = buildAddress(row);
        const prefix  = `[${String(i + 1).padStart(3)}/${rows.length}]`;

        if (!address) {
            console.log(`${prefix} SKIPPED — could not build address from row ${row.id}`);
            results.push({ id: row.id, address: null, success: false, error: 'EMPTY_ADDRESS', addressesFound: 0, zone_id: null, duration_ms: 0 });
            skippedCount++;
            continue;
        }

        process.stdout.write(`${prefix} ${address.substring(0, 65).padEnd(65)} `);

        const start  = Date.now();
        const result = await findAddresses(address, token);
        const ms     = Date.now() - start;

        results.push({
            id:             row.id,
            address,
            success:        result.success,
            error:          result.error,
            addressesFound: result.addresses.length,
            zone_id:        result.zone_id,
            duration_ms:    ms
        });

        if (result.success) {
            successCount++;
            console.log(`✓  ${result.addresses.length} props  (${(ms / 1000).toFixed(1)}s)`);
        } else {
            failureCount++;
            console.log(`✗  ${result.error}  (${(ms / 1000).toFixed(1)}s)`);
        }

        if (i < rows.length - 1) await sleep(DELAY_BETWEEN_MS);
    }

    // 4. Save results JSON
    const ts          = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const resultsFile = path.join(CSV_DIR, `results_${csvFile.replace('.csv', '')}_${ts}.json`);
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));

    // 5. Print report
    const total        = results.length;
    const accuracy     = ((successCount / (total - skippedCount)) * 100).toFixed(1);
    const avgFound     = successCount > 0
        ? (results.filter(r => r.success).reduce((s, r) => s + r.addressesFound, 0) / successCount).toFixed(1)
        : '0';
    const failedRows   = results.filter(r => !r.success && r.error !== 'EMPTY_ADDRESS');
    const skippedRows  = results.filter(r => r.error === 'EMPTY_ADDRESS');

    const bar = '─'.repeat(60);
    console.log(`\n${bar}`);
    console.log('RESULTS');
    console.log(bar);
    console.log(`Total rows processed  : ${total}`);
    console.log(`Successful (zone ✓)   : ${successCount}`);
    console.log(`Failed (no results)   : ${failureCount}`);
    console.log(`Skipped (bad data)    : ${skippedCount}`);
    console.log(`Accuracy rate         : ${accuracy}%`);
    console.log(`Avg properties found  : ${avgFound}`);

    if (failedRows.length) {
        console.log(`\n${bar}`);
        console.log('FAILED ADDRESSES');
        console.log(bar);
        failedRows.forEach(r => console.log(`  [${r.id}] ${r.address}  →  ${r.error}`));
    }

    if (skippedRows.length) {
        console.log(`\n${bar}`);
        console.log('SKIPPED (unparseable rows)');
        console.log(bar);
        skippedRows.forEach(r => console.log(`  [${r.id}] (empty address)`));
    }

    console.log(`\n${bar}`);
    console.log(`Results saved → ${resultsFile}`);
    console.log(bar + '\n');
}

main().catch(err => { console.error('\nFatal error:', err.message); process.exit(1); });
