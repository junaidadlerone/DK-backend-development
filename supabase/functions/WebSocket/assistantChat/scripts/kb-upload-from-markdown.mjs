// KB uploader: pushes corrected pages from KB_UPDATES/ into the Notion KB.
// - Existing pages: archive all current blocks, append converted markdown.
// - New pages (notion_page_id: NEW-PAGE): create in the database (Status: Active).
// - Strips inline [VERIFY: ...] tags (the checklist lives in KB_UPDATES/README.md).
// Usage (cwd must be assistantChat for .env):  node kb-upload.mjs <file.md> [...more]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const H = { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" };
const DB = process.env.NOTION_DATABASE_ID;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NEW_PAGE_CATEGORY = {
  "QR-Codes-on-Postcards.md": "Campaigns",
  "Address-List-Campaign-Management.md": "Campaigns",
  "Building-Your-Campaign-Audience.md": "Targeting",
  "Notifications.md": "Settings & Account",
  "Signing-In-and-Email-Verification.md": "Settings & Account",
  "Campaign-Detail-Tabs.md": "Campaigns",
  "Creating-Additional-Organizations.md": "Agency",
};

async function api(method, path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.notion.com/v1${path}`, { method, headers: H, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (res.status === 429 || res.status >= 500) { await sleep(1200 * (attempt + 1)); continue; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json.message ?? ""}`);
    await sleep(350); // stay under Notion's ~3 req/s
    return json;
  }
  throw new Error(`${method} ${path} → rate-limited after retries`);
}

// ── markdown → rich_text (bold support, 2000-char chunks, VERIFY tags stripped) ──
function richText(s) {
  const clean = s.replace(/\s*\[VERIFY[^\]]*\]/g, "").trimEnd();
  const out = [];
  for (const part of clean.split(/(\*\*[^*]+\*\*)/g)) {
    if (!part) continue;
    const bold = part.startsWith("**") && part.endsWith("**");
    const text = bold ? part.slice(2, -2) : part;
    for (let i = 0; i < text.length; i += 2000) {
      out.push({ type: "text", text: { content: text.slice(i, i + 2000) }, ...(bold ? { annotations: { bold: true } } : {}) });
    }
  }
  return out.length ? out : [{ type: "text", text: { content: "" } }];
}

// ── markdown → Notion blocks ──────────────────────────────────────────────────
function toBlocks(md) {
  const lines = md.split("\n");
  const blocks = [];
  let table = null;
  let seenH1 = false;
  const flushTable = () => {
    if (!table || !table.length) { table = null; return; }
    const width = Math.max(...table.map((r) => r.length));
    blocks.push({
      object: "block", type: "table",
      table: {
        table_width: width, has_column_header: true, has_row_header: false,
        children: table.map((cells) => ({
          object: "block", type: "table_row",
          table_row: { cells: Array.from({ length: width }, (_, i) => (cells[i] !== undefined ? richText(cells[i]) : [])) },
        })),
      },
    });
    table = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const t = line.trim();
    if (t.startsWith("<!--")) continue;
    if (t.startsWith("|")) {
      const cells = t.slice(1, t.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim());
      if (cells.every((c) => /^[-: ]*$/.test(c))) continue; // separator row
      (table ??= []).push(cells);
      continue;
    }
    flushTable();
    if (!t) continue;
    if (/^---+$/.test(t)) { blocks.push({ object: "block", type: "divider", divider: {} }); continue; }
    const h = t.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      if (h[1] === "#" && !seenH1) { seenH1 = true; continue; } // page title lives on the Notion page itself
      const level = Math.min(h[1].length, 3);
      blocks.push({ object: "block", type: `heading_${level}`, [`heading_${level}`]: { rich_text: richText(h[2]) } });
      continue;
    }
    const num = t.match(/^\d+[.)]\s+(.*)/);
    if (num) { blocks.push({ object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: richText(num[1]) } }); continue; }
    const bul = t.match(/^[-*]\s+(.*)/);
    if (bul) { blocks.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: richText(bul[1]) } }); continue; }
    blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: richText(t) } });
  }
  flushTable();
  return blocks.filter((b) => b.type !== "paragraph" || b.paragraph.rich_text.some((r) => r.text.content.trim()));
}

// ── page operations ───────────────────────────────────────────────────────────
async function clearPage(pageId) {
  let cursor, ids = [];
  do {
    const res = await api("GET", `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`);
    ids.push(...res.results.map((b) => b.id));
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  for (const id of ids) await api("DELETE", `/blocks/${id}`);
  return ids.length;
}

async function appendBlocks(pageId, blocks) {
  for (let i = 0; i < blocks.length; i += 90) {
    await api("PATCH", `/blocks/${pageId}/children`, { children: blocks.slice(i, i + 90) });
  }
}

async function uploadFile(path) {
  const md = readFileSync(path, "utf8");
  const name = basename(path);
  const idMatch = md.match(/notion_page_id:\s*([0-9a-f-]{32,36})/i);
  const title = (md.match(/^#\s+(.*)$/m) ?? [, name.replace(/\.md$/, "")])[1].trim();
  const blocks = toBlocks(md);

  if (idMatch) {
    const pageId = idMatch[1];
    const removed = await clearPage(pageId);
    await appendBlocks(pageId, blocks);
    console.log(`UPDATED  ${title}  (removed ${removed} blocks, wrote ${blocks.length})`);
  } else {
    const category = NEW_PAGE_CATEGORY[name];
    const page = await api("POST", "/pages", {
      parent: { database_id: DB },
      properties: {
        Name: { title: [{ type: "text", text: { content: title } }] },
        Status: { select: { name: "Active" } },
        ...(category ? { Category: { select: { name: category } } } : {}),
      },
    });
    await appendBlocks(page.id, blocks);
    console.log(`CREATED  ${title}  (${blocks.length} blocks, category ${category ?? "none"}, id ${page.id})`);
  }
}

for (const f of process.argv.slice(2)) {
  try { await uploadFile(f); }
  catch (e) { console.error(`FAILED   ${basename(f)}: ${e.message}`); process.exitCode = 1; }
}
