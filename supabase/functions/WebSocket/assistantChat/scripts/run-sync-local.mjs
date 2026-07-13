/**
 * Local one-shot KB sync — runs the same logic as the Inngest function, directly
 * (no Inngest involved). Useful for first-time population and local debugging.
 *
 *   npm run sync:local
 */

import "dotenv/config";
import { queryNotionDatabase, embedPageToPinecone, isActive } from "../src/sync.mjs";

const started = Date.now();
const pages = await queryNotionDatabase();
console.log(`Fetched ${pages.length} pages from Notion`);

let processed = 0, skipped = 0, unchanged = 0, failed = 0;

for (let i = 0; i < pages.length; i++) {
  const page = pages[i];
  if (!isActive(page)) { skipped++; continue; }
  try {
    const result = await embedPageToPinecone(page);
    if (result.unchanged)     { unchanged++; console.log(`(${i + 1}/${pages.length}) unchanged`); }
    else if (result.skipped)  { skipped++;   console.log(`(${i + 1}/${pages.length}) skipped (too short)`); }
    else                      { processed++; console.log(`(${i + 1}/${pages.length}) embedded: ${result.chunks} chunks, ${result.upserted} vectors`); }
  } catch (err) {
    failed++;
    console.error(`(${i + 1}/${pages.length}) FAILED: ${err.message}`);
  }
}

console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s — processed=${processed} unchanged=${unchanged} skipped=${skipped} failed=${failed}`);
