#!/usr/bin/env node
/**
 * ops-playbook-sync — chunk docs/internal/dk-ops-playbook.md by ## section, embed with
 * text-embedding-3-small, upsert into the `dk-internal` namespace of the doorknocker-kb
 * Pinecone index, and delete stale vectors (ids no longer in the doc).
 *
 * Run from assistantChat/ (reads its .env):
 *   node scripts/ops-playbook-sync.mjs --dry-run     # print chunks + ids, write nothing
 *   node scripts/ops-playbook-sync.mjs               # sync for real
 *
 * The agent consults these vectors via the `dk_ops` Flowise knowledge entry — INTERNAL
 * reasoning content only; never mix with the default (product docs) namespace.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pinecone } from "@pinecone-database/pinecone";

const NAMESPACE = "dk-internal";
const EMBED_MODEL = "text-embedding-3-small";
const PINECONE_API_KEY = process.env.PINECONE_API_KEY ?? "";
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME ?? "doorknocker-kb";
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY ?? "";

const slug = (heading) =>
  heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Split the playbook into one chunk per ## section. Exported for tests. */
export function splitPlaybook(markdown) {
  const chunks = [];
  const parts = String(markdown).split(/^## /m).slice(1); // drop preamble
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const body = (nl === -1 ? "" : part.slice(nl + 1)).trim();
    if (!heading || !body) continue;
    chunks.push({
      id: `ops-${slug(heading)}`,
      heading,
      // Title-prefixed so a chunk retrieved solo still says what it is.
      content: `DoorKnocker+ agent internal ops — ${heading}\n\n${body}`,
    });
  }
  return chunks;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const argPath = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, argPath ?? "../../../../../docs/internal/dk-ops-playbook.md");

  const chunks = splitPlaybook(readFileSync(path, "utf8"));
  if (!chunks.length) throw new Error(`no ## sections found in ${path}`);
  console.log(`[playbook] ${chunks.length} sections from ${path}`);
  for (const c of chunks) console.log(`  ${c.id}  (${c.content.length} chars)`);
  if (dryRun) return;

  if (!PINECONE_API_KEY || !OPENAI_KEY) throw new Error("PINECONE_API_KEY / OPENAI_API_KEY missing (.env)");

  const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: chunks.map((c) => c.content) }),
  });
  if (!embedRes.ok) throw new Error(`OpenAI embed error: ${embedRes.status}`);
  const embedData = await embedRes.json();

  const vectors = chunks.map((c, i) => ({
    id: c.id,
    values: embedData.data[i].embedding,
    metadata: { source: "dk-ops-playbook", heading: c.heading, content: c.content },
  }));

  const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
  const { host } = await pc.describeIndex(PINECONE_INDEX_NAME);

  // REST directly — same pattern as src/sync.mjs (SDK ^8.x validator quirks).
  const up = await fetch(`https://${host}/vectors/upsert`, {
    method: "POST",
    headers: { "Api-Key": PINECONE_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ vectors, namespace: NAMESPACE }),
  });
  if (!up.ok) throw new Error(`Pinecone upsert ${up.status}: ${(await up.text()).slice(0, 200)}`);
  console.log(`[pinecone] upserted ${vectors.length} vectors → namespace ${NAMESPACE}`);

  // Stale cleanup: list this script's ids (ops-* prefix ONLY — the namespace may host other
  // content one day; never treat foreign ids as stale) and delete any not in the current doc.
  // /vectors/list pages via paginationToken — follow it so ids beyond one page are seen.
  const keep = new Set(vectors.map((v) => v.id));
  const staleCandidates = [];
  let paginationToken = null;
  let listFailed = false;
  do {
    const url = new URL(`https://${host}/vectors/list`);
    url.searchParams.set("namespace", NAMESPACE);
    url.searchParams.set("prefix", "ops-");
    url.searchParams.set("limit", "100");
    if (paginationToken) url.searchParams.set("paginationToken", paginationToken);
    const listRes = await fetch(url, { headers: { "Api-Key": PINECONE_API_KEY } });
    if (!listRes.ok) {
      console.warn(`[pinecone] list failed (${listRes.status}) — skip stale cleanup`);
      listFailed = true;
      break;
    }
    const listed = await listRes.json();
    for (const v of listed.vectors ?? []) {
      if (v.id.startsWith("ops-") && !keep.has(v.id)) staleCandidates.push(v.id);
    }
    paginationToken = listed.pagination?.next ?? null;
  } while (paginationToken);

  if (!listFailed) {
    if (staleCandidates.length) {
      const del = await fetch(`https://${host}/vectors/delete`, {
        method: "POST",
        headers: { "Api-Key": PINECONE_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ ids: staleCandidates, namespace: NAMESPACE }),
      });
      if (!del.ok) {
        console.warn(`[pinecone] stale delete FAILED (${del.status}): ${(await del.text()).slice(0, 200)}`);
      } else {
        console.log(`[pinecone] deleted ${staleCandidates.length} stale: ${staleCandidates.join(", ")}`);
      }
    } else {
      console.log("[pinecone] no stale vectors");
    }
  }
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main().catch((e) => { console.error(e.message); process.exit(1); });
