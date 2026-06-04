import { WORK_ITEMS_DB, DAILY_STATUSES_DB, NOTION_VERSION, UAT_TESTERS, ACTIVE_STATUSES } from "./config.ts";
import { WorkItem, Comment, resolveUserName, todayPKT } from "./utils.ts";

const NOTION_TOKEN = Deno.env.get("NOTION_TOKEN") ?? "";
const BASE = "https://api.notion.com/v1";

const H = {
  "Authorization":  `Bearer ${NOTION_TOKEN}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type":   "application/json",
};

async function notionFetch(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion ${method} ${path} → ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

/** Normalise a raw Notion Work Items row into a WorkItem. */
function normaliseItem(row: Record<string, unknown>): WorkItem {
  const p = row.properties as Record<string, Record<string, unknown>>;

  const richText = (field: string) =>
    ((p[field]?.rich_text as Array<{plain_text: string}>) ?? []).map((r) => r.plain_text).join("") || null;

  const select = (field: string) =>
    (p[field]?.select as {name?: string} | null)?.name ?? null;

  const status = (field: string) =>
    (p[field]?.status as {name?: string} | null)?.name ?? "Backlog";

  const date = (field: string) =>
    (p[field]?.date as {start?: string} | null)?.start ?? null;

  const people = (field: string): Array<{id: string; name?: string}> =>
    (p[field]?.people as Array<{id: string; name?: string}>) ?? [];

  const title = () =>
    ((p["Title"]?.title as Array<{plain_text: string}>) ?? []).map((r) => r.plain_text).join("") || "(untitled)";

  const stageOwnerPeople = people("Stage Owner");
  const stageOwnerId     = stageOwnerPeople[0]?.id ?? null;
  const stageOwner       = stageOwnerId ? (resolveUserName(stageOwnerId) ?? stageOwnerPeople[0]?.name?.split(" ")[0] ?? null) : null;

  const parentRelations = (p["Parent item"]?.relation as Array<{id: string}>) ?? [];

  return {
    id:                row.id as string,
    title:             title(),
    status:            status("Work Status"),
    type:              select("Type")         ?? "Task",
    priority:          select("Priority")     ?? "Medium",
    severity:          select("Severity"),
    timeline:          select("Timeline"),
    dueDate:           date("Due Date"),
    assignedTeam:      select("Assigned Team"),
    stageOwner,
    stageOwnerId,
    blockingReason:    richText("Blocking Reason"),
    lastStatusChanged: date("Last Status Changed"),
    createdTime:       row.created_time as string,
    parentId:          parentRelations[0]?.id ?? null,
    progress:          (p["Progress"]?.formula as {string?: string} | null)?.string ?? null,
  };
}

/** Query a Notion DB with pagination. Returns all results. */
async function queryAll(dbId: string, filter?: unknown, sorts?: unknown): Promise<WorkItem[]> {
  const items: WorkItem[] = [];
  let cursor: string | undefined;
  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (filter) body.filter = filter;
    if (sorts)  body.sorts  = sorts;
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch("POST", `/databases/${dbId}/query`, body) as {
      results: Record<string, unknown>[];
      has_more: boolean;
      next_cursor: string | null;
    };
    items.push(...data.results.map(normaliseItem));
    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);
  return items;
}

/** Work items with Timeline=Today OR Due Date=today (for morning briefing). */
export async function getTodayWorkItems(): Promise<WorkItem[]> {
  const today = todayPKT();
  return queryAll(WORK_ITEMS_DB, {
    or: [
      { property: "Timeline",  select: { equals: "Today" } },
      { property: "Due Date",  date:   { equals: today   } },
    ],
  });
}

/** All items currently in active statuses (for midday/dayend). */
export async function getActiveWorkItems(): Promise<WorkItem[]> {
  const filters = [...ACTIVE_STATUSES].map((s) => ({
    property: "Work Status", status: { equals: s },
  }));
  return queryAll(WORK_ITEMS_DB, { or: filters });
}

/** Items in UAT pipeline (for UAT section + accountability). */
export async function getUATItems(): Promise<WorkItem[]> {
  return queryAll(WORK_ITEMS_DB, {
    or: [
      { property: "Work Status", status: { equals: "Ready for UAT" } },
      { property: "Work Status", status: { equals: "In UAT"        } },
      { property: "Work Status", status: { equals: "Approved"      } },
    ],
  });
}

/** Update Stage Owner + Assigned Team on a work item. */
export async function assignWorkItem(itemId: string, ownerName: string, teamName: string): Promise<void> {
  const { TEAM } = await import("./config.ts");
  const member = TEAM[ownerName];
  if (!member) return;
  await notionFetch("PATCH", `/pages/${itemId}`, {
    properties: {
      "Stage Owner":   { people: [{ object: "user", id: member.id }] },
      "Assigned Team": { select: { name: teamName } },
    },
  });
}

// ─── Daily Status DB ───────────────────────────────────────────────────────

/** Find today's Daily Status page or create one. Returns page id. */
export async function getDailyStatusPage(): Promise<string> {
  const today = todayPKT();
  const data = await notionFetch("POST", `/databases/${DAILY_STATUSES_DB}/query`, {
    filter: { property: "Date", date: { equals: today } },
    page_size: 1,
  }) as { results: Array<{id: string}> };

  if (data.results.length > 0) return data.results[0].id;

  const monthName = new Date(`${today}T12:00:00Z`).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const page = await notionFetch("POST", "/pages", {
    parent:     { database_id: DAILY_STATUSES_DB },
    properties: {
      Title: { title: [{ type: "text", text: { content: `Daily Status — ${monthName}` } }] },
      Date:  { date: { start: today } },
    },
  }) as { id: string };
  return page.id;
}

/** Append blocks to a Notion page in chunks of 100 (API limit). */
export async function appendBlocks(pageId: string, blocks: object[]): Promise<void> {
  for (let i = 0; i < blocks.length; i += 100) {
    await notionFetch("PATCH", `/blocks/${pageId}/children`, { children: blocks.slice(i, i + 100) });
  }
}

/** Update numeric / multi_select properties on the Daily Status row. */
export async function updateStatusRowProps(pageId: string, props: Record<string, unknown>): Promise<void> {
  const properties: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(props)) {
    if (typeof val === "number")  properties[key] = { number: val };
    if (typeof val === "string")  properties[key] = { rich_text: [{ type: "text", text: { content: val } }] };
  }
  if (Object.keys(properties).length) await notionFetch("PATCH", `/pages/${pageId}`, { properties });
}

/** Add a label to Briefings Posted multi_select (doesn't duplicate). */
export async function addBriefingPosted(pageId: string, label: string): Promise<void> {
  const page = await notionFetch("GET", `/pages/${pageId}`) as { properties: Record<string, unknown> };
  const existing: Array<{name: string}> =
    (page.properties["Briefings Posted"] as {multi_select: Array<{name: string}>})?.multi_select ?? [];
  if (existing.some((e) => e.name === label)) return;
  await notionFetch("PATCH", `/pages/${pageId}`, {
    properties: {
      "Briefings Posted": { multi_select: [...existing, { name: label }] },
    },
  });
}

/** Update numeric stats in one call. */
export async function updateStats(
  pageId: string,
  stats: Partial<{
    activeDevTasks: number;
    uatQueue:       number;
    handedToUAT:    number;
    approvedToday:  number;
    shippedToday:   number;
    openBlockers:   number;
    kickedBack:     number;
  }>,
): Promise<void> {
  const map: Record<string, number | undefined> = {
    "Active Dev Tasks":   stats.activeDevTasks,
    "UAT Queue":          stats.uatQueue,
    "Handed to UAT":      stats.handedToUAT,
    "Items Approved Today": stats.approvedToday,
    "Items Shipped Today":  stats.shippedToday,
    "Open Blockers":      stats.openBlockers,
    "Kicked Back":        stats.kickedBack,
  };
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    if (v !== undefined) properties[k] = { number: v };
  }
  if (Object.keys(properties).length) await notionFetch("PATCH", `/pages/${pageId}`, { properties });
}

// ─── Comments ──────────────────────────────────────────────────────────────

/** Fetch page-level comments for a block/page id. */
export async function fetchComments(blockId: string): Promise<Comment[]> {
  try {
    const data = await notionFetch("GET", `/comments?block_id=${blockId}&page_size=100`) as {
      results: Array<{
        rich_text: Array<{plain_text: string}>;
        created_time: string;
        created_by: {id: string};
      }>;
    };
    return data.results.map((c) => ({
      text:        c.rich_text.map((r) => r.plain_text).join(""),
      createdTime: c.created_time,
      authorName:  resolveUserName(c.created_by.id) ?? "Unknown",
    }));
  } catch {
    return [];
  }
}

/** Fetch comments for a list of item ids, filtered to those created after `since` (ISO). */
export async function fetchItemComments(
  ids: string[],
  since?: string,
): Promise<Map<string, Comment[]>> {
  const map = new Map<string, Comment[]>();
  for (const id of ids) {
    const all = await fetchComments(id);
    map.set(id, since ? all.filter((c) => c.createdTime >= since) : all);
  }
  return map;
}

/** Read text content of the Morning Briefing section from the status page. */
export async function readMorningSection(pageId: string): Promise<string> {
  const data = await notionFetch("GET", `/blocks/${pageId}/children?page_size=100`) as {
    results: Array<{type: string; [key: string]: unknown}>;
  };
  const lines: string[] = [];
  let inMorning = false;
  for (const block of data.results) {
    const t = block.type as string;
    const richText = (block[t] as {rich_text?: Array<{plain_text: string}>} | undefined)?.rich_text ?? [];
    const text = richText.map((r) => r.plain_text).join("");
    if (t === "heading_2") {
      if (text.includes("Morning")) { inMorning = true; continue; }
      if (inMorning) break; // hit next h2
    }
    if (inMorning && text) lines.push(text);
  }
  return lines.join("\n").slice(0, 3000);
}
