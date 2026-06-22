import { createSupabaseClient } from "../_shared/client.ts";
import { corsResponse, successResponse, errorResponse } from "../_shared/response.ts";

const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN") ?? "";
const NOTION_DATABASE_ID = Deno.env.get("NOTION_DATABASE_ID") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const NOTION_VERSION = "2022-06-28";

const CHUNK_SIZE = 1600;
const CHUNK_OVERLAP = 200;
const MIN_CHUNK_LENGTH = 60;
const EMBED_BATCH_SIZE = 20;

// ── Notion REST helpers (no SDK — plain fetch) ────────────────────────────────

async function notionGet(path: string): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
    },
  });
  if (!res.ok) throw new Error(`Notion GET ${path} → ${res.status}`);
  return res.json();
}

async function notionPost(path: string, body: object): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Notion POST ${path} → ${res.status}`);
  return res.json();
}

async function queryDatabase(): Promise<any[]> {
  const pages: any[] = [];
  let cursor: string | undefined;
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

async function fetchBlocks(blockId: string, depth = 0): Promise<any[]> {
  const blocks: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await notionGet(
      `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`
    );
    for (const block of res.results ?? []) {
      if (block.has_children && depth < 4) {
        block.children = await fetchBlocks(block.id, depth + 1);
      }
      blocks.push(block);
    }
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
  return blocks;
}

// ── Block → plain text ────────────────────────────────────────────────────────

function rt(richText: any[]): string {
  return (richText ?? []).map((t: any) => t.plain_text ?? "").join("");
}

function blocksToText(blocks: any[], depth = 0): string {
  const lines: string[] = [];
  const pad = "  ".repeat(depth);
  for (const b of blocks) {
    switch (b.type) {
      case "paragraph":       lines.push(pad + rt(b.paragraph?.rich_text)); break;
      case "heading_1":       lines.push("# " + rt(b.heading_1?.rich_text)); break;
      case "heading_2":       lines.push("## " + rt(b.heading_2?.rich_text)); break;
      case "heading_3":       lines.push("### " + rt(b.heading_3?.rich_text)); break;
      case "bulleted_list_item": lines.push(pad + "- " + rt(b.bulleted_list_item?.rich_text)); break;
      case "numbered_list_item": lines.push(pad + "1. " + rt(b.numbered_list_item?.rich_text)); break;
      case "toggle":          lines.push(pad + rt(b.toggle?.rich_text)); break;
      case "quote":           lines.push(pad + "> " + rt(b.quote?.rich_text)); break;
      case "callout":         lines.push(pad + rt(b.callout?.rich_text)); break;
      case "code":            lines.push("```\n" + rt(b.code?.rich_text) + "\n```"); break;
      case "divider":         lines.push("---"); break;
      case "table_row": {
        const cells = (b.table_row?.cells ?? []).map((c: any[]) => rt(c)).join(" | ");
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

function getTitle(page: any): string {
  for (const prop of Object.values(page.properties ?? {}) as any[]) {
    if (prop.type === "title" && prop.title?.length > 0) return rt(prop.title) || "Untitled";
  }
  return "Untitled";
}

function isActive(page: any): boolean {
  for (const [name, prop] of Object.entries(page.properties ?? {}) as [string, any][]) {
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

// ── Chunking ──────────────────────────────────────────────────────────────────

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const chunk = text.slice(start, start + CHUNK_SIZE).trim();
    if (chunk.length >= MIN_CHUNK_LENGTH) chunks.push(chunk);
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

// ── Embed one page ────────────────────────────────────────────────────────────

async function embedPage(
  page: any,
  supabase: ReturnType<typeof createSupabaseClient>
): Promise<{ chunks: number; skipped: boolean }> {
  const title = getTitle(page);
  const sourceFile = `notion/${page.id}`;

  const blocks = await fetchBlocks(page.id);
  const body = blocksToText(blocks);
  const fullText = `# ${title}\n\n${body}`.trim();

  if (fullText.length < MIN_CHUNK_LENGTH) return { chunks: 0, skipped: true };

  const chunks = chunkText(fullText);
  if (chunks.length === 0) return { chunks: 0, skipped: true };

  // Delete existing chunks for this page
  await supabase.from("knowledge_chunks").delete().eq("source_file", sourceFile);

  // Embed + insert in batches
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: batch }),
    });
    if (!embedRes.ok) throw new Error(`OpenAI embed error: ${embedRes.status}`);
    const embedData = await embedRes.json();

    await supabase.from("knowledge_chunks").insert(
      batch.map((content, j) => ({
        source_file: sourceFile,
        content,
        embedding: embedData.data[j].embedding,
      }))
    );
  }

  return { chunks: chunks.length, skipped: false };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", "Use POST", 405);

  if (!NOTION_TOKEN || !NOTION_DATABASE_ID || !OPENAI_API_KEY) {
    return errorResponse(
      "Configuration error",
      "Missing NOTION_TOKEN, NOTION_DATABASE_ID, or OPENAI_API_KEY",
      500
    );
  }

  const supabase = createSupabaseClient();
  const startTime = Date.now();

  try {
    const pages = await queryDatabase();

    let processed = 0;
    let skipped = 0;
    let totalChunks = 0;

    for (const page of pages) {
      if (!isActive(page)) { skipped++; continue; }
      const { chunks, skipped: isEmpty } = await embedPage(page, supabase);
      if (isEmpty) { skipped++; continue; }
      totalChunks += chunks;
      processed++;
    }

    const { count } = await supabase
      .from("knowledge_chunks")
      .select("*", { count: "exact", head: true });

    return successResponse({
      ok: true,
      pages_processed: processed,
      pages_skipped: skipped,
      chunks_this_run: totalChunks,
      total_chunks_in_table: count ?? 0,
      duration_ms: Date.now() - startTime,
    });
  } catch (err: any) {
    console.error("syncNotionKB error:", err);
    return errorResponse("Sync failed", err.message, 500);
  }
});
