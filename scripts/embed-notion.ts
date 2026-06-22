/**
 * Sync Notion database → Supabase pgvector knowledge base.
 *
 * Usage:
 *   cd scripts
 *   npm install
 *   NOTION_TOKEN=ntn_... \
 *   NOTION_DATABASE_ID=... \
 *   OPENAI_API_KEY=sk-... \
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=eyJ... \
 *   npm run embed:notion
 *
 * Pages with a "Status" property set to "Draft" or "Archived" are skipped.
 * Pages with no Status property are included by default.
 * Re-run any time you update pages in Notion — existing chunks are replaced.
 */

import { Client } from "@notionhq/client";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const NOTION_TOKEN = process.env.NOTION_TOKEN ?? "";
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID ?? "";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";

if (!NOTION_TOKEN || !NOTION_DATABASE_ID || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !OPENAI_API_KEY) {
  console.error(
    "Missing required env vars: NOTION_TOKEN, NOTION_DATABASE_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY, OPENAI_API_KEY"
  );
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const CHUNK_SIZE = 1600;
const CHUNK_OVERLAP = 200;
const MIN_CHUNK_LENGTH = 60;
const EMBED_BATCH_SIZE = 20;

// ── Text helpers ─────────────────────────────────────────────────────────────

function richText(rt: any[]): string {
  return (rt ?? []).map((t: any) => t.plain_text ?? "").join("");
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length >= MIN_CHUNK_LENGTH) chunks.push(chunk);
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

// ── Notion page helpers ───────────────────────────────────────────────────────

function getPageTitle(page: any): string {
  for (const prop of Object.values(page.properties ?? {}) as any[]) {
    if (prop.type === "title" && prop.title?.length > 0) {
      return richText(prop.title) || "Untitled";
    }
  }
  return "Untitled";
}

function isActive(page: any): boolean {
  for (const [name, prop] of Object.entries(page.properties ?? {}) as [string, any][]) {
    if (name.toLowerCase() !== "status") continue;

    let value = "";
    if (prop.type === "status") value = prop.status?.name ?? "";
    else if (prop.type === "select") value = prop.select?.name ?? "";

    if (!value) return true; // property exists but empty — include

    const v = value.toLowerCase();
    if (v.includes("draft") || v.includes("archiv")) return false;
    return true;
  }
  return true; // no Status property — include
}

// ── Block fetcher (recursive, handles pagination) ────────────────────────────

async function fetchBlocks(blockId: string, depth = 0): Promise<any[]> {
  const blocks: any[] = [];
  let cursor: string | undefined;

  do {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const block of res.results as any[]) {
      if (block.has_children && depth < 5) {
        block.children = await fetchBlocks(block.id, depth + 1);
      }
      blocks.push(block);
    }

    cursor = res.next_cursor ?? undefined;
  } while (cursor);

  return blocks;
}

// ── Block → plain text ───────────────────────────────────────────────────────

function blocksToText(blocks: any[], depth = 0): string {
  const lines: string[] = [];
  const pad = "  ".repeat(depth);

  for (const block of blocks) {
    switch (block.type) {
      case "paragraph": {
        const t = richText(block.paragraph?.rich_text);
        if (t) lines.push(pad + t);
        break;
      }
      case "heading_1":
        lines.push("# " + richText(block.heading_1?.rich_text));
        break;
      case "heading_2":
        lines.push("## " + richText(block.heading_2?.rich_text));
        break;
      case "heading_3":
        lines.push("### " + richText(block.heading_3?.rich_text));
        break;
      case "bulleted_list_item":
        lines.push(pad + "- " + richText(block.bulleted_list_item?.rich_text));
        break;
      case "numbered_list_item":
        lines.push(pad + "1. " + richText(block.numbered_list_item?.rich_text));
        break;
      case "toggle":
        lines.push(pad + richText(block.toggle?.rich_text));
        break;
      case "quote":
        lines.push(pad + "> " + richText(block.quote?.rich_text));
        break;
      case "callout":
        lines.push(pad + richText(block.callout?.rich_text));
        break;
      case "code": {
        const lang = block.code?.language ?? "";
        const code = richText(block.code?.rich_text);
        lines.push(`\`\`\`${lang}\n${code}\n\`\`\``);
        break;
      }
      case "divider":
        lines.push("---");
        break;
      case "table_row": {
        const cells = (block.table_row?.cells ?? [])
          .map((cell: any[]) => richText(cell))
          .join(" | ");
        if (cells) lines.push(`| ${cells} |`);
        break;
      }
      // child_page, child_database, image, video, embed, etc. — skip
    }

    // Recurse into children (toggle contents, table rows, nested lists)
    if (block.children?.length) {
      const childText = blocksToText(
        block.children,
        block.type === "table" ? depth : depth + 1
      );
      if (childText) lines.push(childText);
    }
  }

  return lines.filter(Boolean).join("\n");
}

// ── Embed one page ────────────────────────────────────────────────────────────

async function embedPage(page: any): Promise<number> {
  const title = getPageTitle(page);
  const sourceFile = `notion/${page.id}`;

  console.log(`  "${title}"`);

  const blocks = await fetchBlocks(page.id);
  const bodyText = blocksToText(blocks);
  const fullText = `# ${title}\n\n${bodyText}`.trim();

  if (fullText.length < MIN_CHUNK_LENGTH) {
    console.log(`    (empty — skipped)`);
    return 0;
  }

  const chunks = chunkText(fullText);
  console.log(`    → ${chunks.length} chunk(s)`);

  const { error: deleteError } = await supabase
    .from("knowledge_chunks")
    .delete()
    .eq("source_file", sourceFile);

  if (deleteError) {
    console.error(`    ✗ Delete failed:`, deleteError.message);
    return 0;
  }

  if (chunks.length === 0) return 0;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);

    const embedRes = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: batch,
    });

    const rows = batch.map((content, j) => ({
      source_file: sourceFile,
      content,
      embedding: embedRes.data[j].embedding,
    }));

    const { error: insertError } = await supabase
      .from("knowledge_chunks")
      .insert(rows);

    if (insertError) {
      console.error(`    ✗ Insert failed (batch ${i}):`, insertError.message);
    }
  }

  return chunks.length;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Optionally wipe the entire knowledge_chunks table before re-embedding.
  // Useful when switching from markdown-sourced chunks to Notion-sourced chunks.
  // Set CLEAR_EXISTING=true to enable.
  if (process.env.CLEAR_EXISTING === "true") {
    console.log("⚠️  Clearing all existing knowledge_chunks rows...");
    const { error } = await supabase
      .from("knowledge_chunks")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000"); // delete all rows
    if (error) {
      console.error("  ✗ Clear failed:", error.message);
      process.exit(1);
    }
    console.log("  ✓ Table cleared\n");
  }

  console.log("📖 Fetching pages from Notion database...\n");

  const pages: any[] = [];
  let cursor: string | undefined;

  do {
    const res = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(...res.results);
    cursor = res.next_cursor ?? undefined;
  } while (cursor);

  console.log(`Found ${pages.length} page(s)\n`);

  let processed = 0;
  let skipped = 0;
  let totalChunks = 0;

  for (const page of pages) {
    if (!isActive(page)) {
      console.log(`  Skipping (Draft/Archived): "${getPageTitle(page)}"`);
      skipped++;
      continue;
    }
    totalChunks += await embedPage(page);
    processed++;
  }

  const { count } = await supabase
    .from("knowledge_chunks")
    .select("*", { count: "exact", head: true });

  console.log(`\n✅ Done.`);
  console.log(`   Pages processed : ${processed}  |  Skipped: ${skipped}`);
  console.log(`   Chunks this run : ${totalChunks}`);
  console.log(`   Total in table  : ${count ?? "?"}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
