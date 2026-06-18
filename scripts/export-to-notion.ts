/**
 * Export docs/kb/ markdown files → Notion database.
 *
 * Usage:
 *   cd scripts
 *   NOTION_TOKEN=ntn_... NOTION_DATABASE_ID=... npm run export:notion
 *
 * What it does:
 *   1. Adds Category (Select) and Status (Select) properties to the database
 *   2. Reads all 29 markdown files under docs/kb/
 *   3. Creates one Notion page per file with full content as blocks
 *   4. Skips pages that already exist (same title) — safe to re-run
 *
 * After this, run embed:notion to sync the Notion pages into Supabase pgvector.
 */

import { Client } from "@notionhq/client";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, "../docs/kb");

const NOTION_TOKEN = process.env.NOTION_TOKEN ?? "";
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID ?? "";

if (!NOTION_TOKEN || !NOTION_DATABASE_ID) {
  console.error("Missing required env vars: NOTION_TOKEN, NOTION_DATABASE_ID");
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CATEGORY_MAP: Record<string, string> = {
  "01-product": "Product",
  "02-campaigns": "Campaigns",
  "03-targeting": "Targeting",
  "04-templates": "Templates",
  "05-analytics": "Analytics",
  "06-referrals": "Referrals",
  "07-team-and-roles": "Team & Roles",
  "08-agency": "Agency",
  "09-settings-and-account": "Settings & Account",
  "10-support": "Support",
};

// ── Inline markdown → Notion rich text ───────────────────────────────────────

function parseRichText(text: string): any[] {
  if (!text.trim()) return [{ type: "text", text: { content: "" } }];

  const parts: any[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`\n]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const plain = text.slice(lastIndex, match.index);
      if (plain) parts.push({ type: "text", text: { content: plain.slice(0, 2000) } });
    }

    if (match[1] !== undefined) {
      parts.push({ type: "text", text: { content: match[1].slice(0, 2000) }, annotations: { bold: true } });
    } else if (match[2] !== undefined) {
      parts.push({ type: "text", text: { content: match[2].slice(0, 2000) }, annotations: { italic: true } });
    } else if (match[3] !== undefined) {
      parts.push({ type: "text", text: { content: match[3].slice(0, 2000) }, annotations: { code: true } });
    } else if (match[4] !== undefined && match[5] !== undefined) {
      parts.push({ type: "text", text: { content: match[4].slice(0, 2000), link: { url: match[5] } } });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex);
    if (rest) parts.push({ type: "text", text: { content: rest.slice(0, 2000) } });
  }

  return parts.length > 0 ? parts : [{ type: "text", text: { content: text.slice(0, 2000) } }];
}

// ── Markdown → Notion blocks ──────────────────────────────────────────────────

function markdownToBlocks(markdown: string): { title: string; blocks: any[] } {
  const lines = markdown.split("\n");
  const blocks: any[] = [];
  let title = "Untitled";
  let titleFound = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // H1 — first one becomes page title, rest become heading blocks
    if (line.startsWith("# ")) {
      const text = line.slice(2).trim();
      if (!titleFound) {
        title = text;
        titleFound = true;
      } else {
        blocks.push({ object: "block", type: "heading_1", heading_1: { rich_text: parseRichText(text) } });
      }
      i++;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: parseRichText(line.slice(3).trim()) } });
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: parseRichText(line.slice(4).trim()) } });
      i++;
      continue;
    }

    // Bullet list
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: parseRichText(trimmed.slice(2)) },
      });
      i++;
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: { rich_text: parseRichText(trimmed.replace(/^\d+\.\s/, "")) },
      });
      i++;
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim() || "plain text";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        object: "block",
        type: "code",
        code: {
          language: lang,
          rich_text: [{ type: "text", text: { content: codeLines.join("\n").slice(0, 2000) } }],
        },
      });
      continue;
    }

    // Table
    if (trimmed.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }

      // Remove separator rows (|---|---|)
      const dataRows = tableLines.filter((l) => !/^\s*\|[-|:\s]+\|\s*$/.test(l));
      if (dataRows.length === 0) continue;

      const parsedRows = dataRows.map((row) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim())
      );

      const tableWidth = Math.max(...parsedRows.map((r) => r.length));
      if (tableWidth === 0) continue;

      blocks.push({
        object: "block",
        type: "table",
        table: {
          table_width: tableWidth,
          has_column_header: true,
          has_row_header: false,
          children: parsedRows.map((cells) => ({
            object: "block",
            type: "table_row",
            table_row: {
              cells: Array.from({ length: tableWidth }, (_, ci) =>
                cells[ci] != null
                  ? parseRichText(cells[ci])
                  : [{ type: "text", text: { content: "" } }]
              ),
            },
          })),
        },
      } as any);
      continue;
    }

    // Divider
    if (trimmed === "---" || trimmed === "***" || trimmed === "___") {
      blocks.push({ object: "block", type: "divider", divider: {} });
      i++;
      continue;
    }

    // Empty line — skip
    if (!trimmed) {
      i++;
      continue;
    }

    // Paragraph
    blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: parseRichText(trimmed) } });
    i++;
  }

  return { title, blocks };
}

// ── File helpers ──────────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...walkDir(full));
    else if (entry.endsWith(".md")) results.push(full);
  }
  return results;
}

function getCategory(filePath: string): string {
  const rel = relative(DOCS_DIR, filePath);
  const folder = rel.split("/")[0];
  return CATEGORY_MAP[folder] ?? folder;
}

// ── Notion helpers ────────────────────────────────────────────────────────────

async function setupDatabase(): Promise<void> {
  console.log("Configuring database properties...");
  const db = (await notion.databases.retrieve({ database_id: NOTION_DATABASE_ID })) as any;
  const existing = Object.keys(db.properties ?? {});
  const toAdd: Record<string, any> = {};

  if (!existing.includes("Category")) {
    toAdd["Category"] = {
      select: {
        options: [
          { name: "Product", color: "blue" },
          { name: "Campaigns", color: "green" },
          { name: "Targeting", color: "orange" },
          { name: "Templates", color: "purple" },
          { name: "Analytics", color: "yellow" },
          { name: "Referrals", color: "pink" },
          { name: "Team & Roles", color: "gray" },
          { name: "Agency", color: "red" },
          { name: "Settings & Account", color: "brown" },
          { name: "Support", color: "default" },
        ],
      },
    };
  }

  if (!existing.includes("Status")) {
    toAdd["Status"] = {
      select: {
        options: [
          { name: "Active", color: "green" },
          { name: "Draft", color: "yellow" },
          { name: "Archived", color: "red" },
        ],
      },
    };
  }

  if (Object.keys(toAdd).length > 0) {
    await notion.databases.update({ database_id: NOTION_DATABASE_ID, properties: toAdd });
    console.log(`  Added: ${Object.keys(toAdd).join(", ")}`);
  } else {
    console.log("  Already configured — nothing to add");
  }
}

async function getExistingTitles(): Promise<Set<string>> {
  const titles = new Set<string>();
  let cursor: string | undefined;

  do {
    const res = await notion.databases.query({
      database_id: NOTION_DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
    });

    for (const page of res.results as any[]) {
      for (const prop of Object.values(page.properties ?? {}) as any[]) {
        if (prop.type === "title" && prop.title?.length > 0) {
          titles.add(prop.title.map((t: any) => t.plain_text).join(""));
          break;
        }
      }
    }

    cursor = res.next_cursor ?? undefined;
  } while (cursor);

  return titles;
}

async function createPage(title: string, category: string, blocks: any[]): Promise<void> {
  const BATCH = 95; // stay under Notion's 100-block limit; table children count separately

  // Create page with first batch
  const page = (await notion.pages.create({
    parent: { database_id: NOTION_DATABASE_ID },
    properties: {
      Name: { title: [{ type: "text", text: { content: title } }] },
      Category: { select: { name: category } },
      Status: { select: { name: "Active" } },
    },
    children: blocks.slice(0, BATCH),
  })) as any;

  // Append remaining blocks in batches
  for (let i = BATCH; i < blocks.length; i += BATCH) {
    await sleep(350);
    await notion.blocks.children.append({
      block_id: page.id,
      children: blocks.slice(i, i + BATCH),
    });
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("🚀 Exporting knowledge base → Notion\n");

  await setupDatabase();
  console.log();

  const existingTitles = await getExistingTitles();
  if (existingTitles.size > 0) {
    console.log(`Found ${existingTitles.size} existing page(s) — will skip duplicates\n`);
  }

  const files = walkDir(DOCS_DIR);
  console.log(`Exporting ${files.length} files...\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const category = getCategory(file);
    const markdown = readFileSync(file, "utf-8");
    const { title, blocks } = markdownToBlocks(markdown);

    if (existingTitles.has(title)) {
      console.log(`  ⟳  (exists) ${title}`);
      skipped++;
      continue;
    }

    process.stdout.write(`  ↑  [${category}] ${title} … `);

    try {
      await createPage(title, category, blocks);
      console.log(`✓ (${blocks.length} blocks)`);
      created++;
    } catch (err: any) {
      console.log(`✗ ${err.message}`);
      failed++;
    }

    await sleep(350); // 3 req/s rate limit
  }

  console.log(`\n✅ Done.`);
  console.log(`   Created : ${created}`);
  console.log(`   Skipped : ${skipped} (already existed)`);
  console.log(`   Failed  : ${failed}`);
  console.log(`\nNext step: run embed:notion to sync pages into the vector store.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
