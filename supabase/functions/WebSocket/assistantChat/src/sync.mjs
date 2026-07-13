/**
 * DoorKnocker+ KB sync — Notion → OpenAI embeddings → Pinecone.
 *
 * Ported from Kabuki Studio's production sync (chatKabuki/index.js:3580-3826) with:
 *  1. OPENAI_KEY declared from env (fixes the undeclared-variable gap in the original)
 *  2. DK+ identifiers: Inngest app "doorknocker", index name from env (default doorknocker-kb)
 *  3. upsert-by-replace kept (delete page's old vectors before re-upserting)
 *  4. a second trigger — event "kb/sync.requested" — so /admin/sync can run it on demand
 *  5. change detection: pages whose Notion last_edited_time matches what's already in
 *     Pinecone are skipped (the original re-embedded every page every hour)
 */

import { Pinecone } from "@pinecone-database/pinecone";
import { Inngest } from "inngest";

// ── Config ────────────────────────────────────────────────────────────────────

const NOTION_TOKEN        = process.env.NOTION_TOKEN ?? "";
const NOTION_DATABASE_ID  = process.env.NOTION_DATABASE_ID ?? "";
const OPENAI_KEY          = process.env.OPENAI_KEY ?? "";
const PINECONE_API_KEY    = process.env.PINECONE_API_KEY ?? "";
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME ?? "doorknocker-kb";

const NOTION_VERSION   = "2022-06-28";
const CHUNK_SIZE       = 1600;
const CHUNK_OVERLAP    = 200;
const MIN_CHUNK_LENGTH = 60;
const EMBED_BATCH_SIZE = 20;

const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
// Cached index host — resolved once, reused for all REST calls
let _pineconeIndexHost = null;

async function getIndexHost() {
  if (!_pineconeIndexHost) {
    const info = await pc.describeIndex(PINECONE_INDEX_NAME);
    _pineconeIndexHost = info.host;
  }
  return _pineconeIndexHost;
}

export const inngest = new Inngest({ id: "doorknocker" });

// ── Notion helpers ────────────────────────────────────────────────────────────

async function notionGet(path) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": NOTION_VERSION },
  });
  if (!res.ok) throw new Error(`Notion GET ${path} → ${res.status}`);
  return res.json();
}

async function notionPost(path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion POST ${path} → ${res.status}`);
  return res.json();
}

export async function queryNotionDatabase() {
  const pages = [];
  let cursor;
  do {
    const res = await notionPost(`/databases/${NOTION_DATABASE_ID}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...(res.results ?? []));
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
  return pages;
}

async function fetchBlocks(blockId, depth = 0) {
  const blocks = [];
  let cursor;
  do {
    const res = await notionGet(`/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    for (const block of res.results ?? []) {
      if (block.has_children && depth < 4) block.children = await fetchBlocks(block.id, depth + 1);
      blocks.push(block);
    }
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
  return blocks;
}

function rt(richText) {
  return (richText ?? []).map((t) => t.plain_text ?? "").join("");
}

function blocksToText(blocks, depth = 0) {
  const lines = [];
  const pad = "  ".repeat(depth);
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph":            lines.push(pad + rt(b.paragraph?.rich_text)); break;
      case "heading_1":            lines.push("# " + rt(b.heading_1?.rich_text)); break;
      case "heading_2":            lines.push("## " + rt(b.heading_2?.rich_text)); break;
      case "heading_3":            lines.push("### " + rt(b.heading_3?.rich_text)); break;
      case "bulleted_list_item":   lines.push(pad + "- " + rt(b.bulleted_list_item?.rich_text)); break;
      case "numbered_list_item":   lines.push(pad + "1. " + rt(b.numbered_list_item?.rich_text)); break;
      case "toggle":               lines.push(pad + rt(b.toggle?.rich_text)); break;
      case "quote":                lines.push(pad + "> " + rt(b.quote?.rich_text)); break;
      case "callout":              lines.push(pad + rt(b.callout?.rich_text)); break;
      case "code":                 lines.push("```\n" + rt(b.code?.rich_text) + "\n```"); break;
      case "to_do":                lines.push(pad + (b.to_do?.checked ? "✓ " : "☐ ") + rt(b.to_do?.rich_text)); break;
      case "bookmark":             lines.push(pad + (b.bookmark?.caption?.length ? rt(b.bookmark.caption) : b.bookmark?.url ?? "")); break;
      case "divider":              lines.push("---"); break;
      case "table_row": {
        const cells = (b.table_row?.cells ?? []).map((c) => rt(c)).join(" | ");
        if (cells) lines.push(`| ${cells} |`);
        break;
      }
    }
    if (b.children?.length) {
      const child = blocksToText(b.children, b.type === "table" ? depth : depth + 1);
      if (child) lines.push(child);
    }
  }
  return lines.filter(Boolean).join("\n");
}

function getTitle(page) {
  for (const prop of Object.values(page.properties ?? {})) {
    if (prop.type === "title" && prop.title?.length > 0) return rt(prop.title) || "Untitled";
  }
  return "Untitled";
}

export function isActive(page) {
  for (const [name, prop] of Object.entries(page.properties ?? {})) {
    if (name.toLowerCase() !== "status") continue;
    let val = "";
    if (prop.type === "status") val = prop.status?.name ?? "";
    else if (prop.type === "select") val = prop.select?.name ?? "";
    if (!val) return true;
    const v = val.toLowerCase();
    if (v.includes("draft") || v.includes("archiv")) return false;
    return true;
  }
  return true;
}

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const chunk = text.slice(start, start + CHUNK_SIZE).trim();
    if (chunk.length >= MIN_CHUNK_LENGTH) chunks.push(chunk);
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

// ── Embed one page → Pinecone ─────────────────────────────────────────────────

export async function embedPageToPinecone(page) {
  const title  = getTitle(page);
  const source = `notion/${page.id}`;
  const lastEdited = page.last_edited_time ?? "";

  const safePageId = page.id.replace(/-/g, "");
  const prefix = `notion__${safePageId}__`;

  // Fresh index reference per call to avoid stale SDK connection state
  const idx = pc.index(PINECONE_INDEX_NAME);

  // Change detection: skip pages whose vectors already reflect this Notion edit.
  // REST, not idx.fetch() — the SDK ^8.x validator rejects the call (same quirk the
  // upsert path works around below).
  if (lastEdited) {
    try {
      const host = await getIndexHost();
      const fetchRes = await fetch(`https://${host}/vectors/fetch?ids=${encodeURIComponent(`${prefix}0`)}`, {
        headers: { "Api-Key": PINECONE_API_KEY },
      });
      if (fetchRes.ok) {
        const fetched = await fetchRes.json();
        const rec = fetched.vectors?.[`${prefix}0`] ?? fetched.records?.[`${prefix}0`];
        if (rec?.metadata?.last_edited === lastEdited) {
          return { chunks: 0, skipped: true, unchanged: true };
        }
      }
    } catch (fetchErr) {
      console.warn(`[Pinecone] change-check for ${page.id} failed (non-fatal, will re-embed): ${fetchErr.message}`);
    }
  }

  const blocks   = await fetchBlocks(page.id);
  const body     = blocksToText(blocks);
  const fullText = `# ${title}\n\n${body}`.trim();

  if (fullText.length < MIN_CHUNK_LENGTH) return { chunks: 0, skipped: true };

  const chunks = chunkText(fullText);
  if (chunks.length === 0) return { chunks: 0, skipped: true };

  // Delete existing vectors for this page (upsert-by-replace)
  try {
    let existingIds = [];
    let paginationToken;
    do {
      const listed = await idx.listPaginated({ prefix, ...(paginationToken ? { paginationToken } : {}) });
      existingIds.push(...(listed.vectors?.map((v) => v.id) ?? []));
      paginationToken = listed.pagination?.next;
    } while (paginationToken);
    if (existingIds.length > 0) await idx.deleteMany(existingIds);
  } catch (delErr) {
    console.warn(`[Pinecone] delete-old for ${page.id} failed (non-fatal): ${delErr.message}`);
  }

  let totalUpserted = 0;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    if (batch.length === 0) continue;

    let embedData;
    try {
      const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: batch }),
      });
      if (!embedRes.ok) throw new Error(`OpenAI embed error: ${embedRes.status}`);
      embedData = await embedRes.json();
    } catch (embedErr) {
      console.error(`[Embed] batch ${i} for page ${page.id} failed: ${embedErr.message}`);
      continue;
    }

    const vectors = batch
      .map((content, j) => ({
        id:     `${prefix}${i + j}`,
        values: Array.isArray(embedData.data?.[j]?.embedding) ? embedData.data[j].embedding : [],
        metadata: { source, heading: title, content, last_edited: lastEdited },
      }))
      .filter((v) => v.values.length > 0);

    console.log(`[Pinecone] page=${page.id} batch=${i} vectors=${vectors.length}`);

    if (vectors.length === 0) continue;

    // Use REST API directly — bypasses SDK validator quirks in ^8.x
    try {
      const host = await getIndexHost();
      const upsertRes = await fetch(`https://${host}/vectors/upsert`, {
        method: "POST",
        headers: { "Api-Key": PINECONE_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ vectors, namespace: "" }),
      });
      if (!upsertRes.ok) {
        const errText = await upsertRes.text().catch(() => "");
        throw new Error(`Pinecone REST upsert ${upsertRes.status}: ${errText.slice(0, 200)}`);
      }
      totalUpserted += vectors.length;
    } catch (upsertErr) {
      console.error(`[Pinecone] upsert failed page=${page.id} batch=${i} vectors=${vectors.length}: ${upsertErr.message}`);
      throw upsertErr;
    }
  }

  return { chunks: chunks.length, upserted: totalUpserted, skipped: false };
}

// ── Inngest: Durable Notion → Pinecone sync ───────────────────────────────────
// Hourly cron + on-demand event (sent by POST /admin/sync).

export const syncNotionKb = inngest.createFunction(
  { id: "sync-notion-kb", name: "Sync Notion KB → Pinecone (DoorKnocker+)", retries: 3 },
  [{ cron: "0 * * * *" }, { event: "kb/sync.requested" }],
  async ({ step, logger }) => {
    const pages = await step.run("fetch-notion-pages", () => queryNotionDatabase());
    logger.info(`Fetched ${pages.length} pages from Notion`);

    let processed = 0;
    let skipped   = 0;
    let unchanged = 0;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!isActive(page)) { skipped++; continue; }

      const result = await step.run(`embed-page-${i}`, () => embedPageToPinecone(page));
      if (result.unchanged) { unchanged++; continue; }
      if (result.skipped)   { skipped++;   continue; }
      processed++;
      logger.info(`Embedded page ${i + 1}/${pages.length}: ${result.chunks} chunks`);
    }

    return { pages_processed: processed, pages_unchanged: unchanged, pages_skipped: skipped };
  }
);
