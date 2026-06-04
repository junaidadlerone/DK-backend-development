import { WORK_ITEMS_DB, NOTION_VERSION, ACTIVE_STATUSES } from "./config.ts";
import { todayPKT } from "./utils.ts";

const TOKEN = Deno.env.get("NOTION_TOKEN") ?? "";
const BASE  = "https://api.notion.com/v1";
const H = {
  "Authorization":  `Bearer ${TOKEN}`,
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

// Statuses that mean "team work is done on this item"
const DONE_FOR_TEAM = new Set(["Shipped", "Approved", "Ready for UAT"]);

interface RawItem {
  id: string;
  status: string;
  timeline: string | null;
  dueDate: string | null;
}

async function fetchAllItems(): Promise<RawItem[]> {
  const items: RawItem[] = [];
  let cursor: string | undefined;

  // Fetch active statuses + Shipped + Approved (need to mark those Completed)
  const allStatuses = [
    ...ACTIVE_STATUSES,
    "Shipped",
    "Approved",
  ];
  const filter = { or: allStatuses.map((s) => ({ property: "Work Status", status: { equals: s } })) };

  do {
    const body: Record<string, unknown> = { page_size: 100, filter };
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch("POST", `/databases/${WORK_ITEMS_DB}/query`, body) as {
      results: Array<Record<string, unknown>>;
      has_more: boolean;
      next_cursor: string | null;
    };

    for (const row of data.results) {
      const p = row.properties as Record<string, Record<string, unknown>>;
      const status   = (p["Work Status"]?.status as { name?: string } | null)?.name ?? "Backlog";
      const timeline = (p["Timeline"]?.select  as { name?: string } | null)?.name ?? null;
      const dueDate  = (p["Due Date"]?.date     as { start?: string } | null)?.start ?? null;
      items.push({ id: row.id as string, status, timeline, dueDate });
    }
    cursor = data.has_more && data.next_cursor ? data.next_cursor : undefined;
  } while (cursor);

  return items;
}

function computeTargetTimeline(item: RawItem, todayStr: string, dayOfWeek: number): string | null {
  // Status-based override — team work is done
  if (DONE_FOR_TEAM.has(item.status)) return "Completed";

  if (item.dueDate) {
    // Days from today to due date (PKT-normalised, date-only arithmetic)
    const todayMs = new Date(todayStr + "T00:00:00+05:00").getTime();
    const dueMs   = new Date(item.dueDate.slice(0, 10) + "T00:00:00+05:00").getTime();
    const days    = Math.round((dueMs - todayMs) / 86_400_000);

    // Days remaining until end of this week (Sunday = 0, Mon = 1, … Sat = 6)
    // Work week Mon–Fri; Sunday counts as start of new week
    const daysToSun   = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;  // 0 if today is Sun
    const thisWeekEnd = Math.max(daysToSun, 0);
    const nextWeekEnd = thisWeekEnd + 7;

    if (days <= 0)            return "Today";
    if (days === 1)           return "Tomorrow";
    if (days <= thisWeekEnd)  return "This Week";
    if (days <= nextWeekEnd)  return "Next Week";
    return "Later";
  }

  // No Due Date — rollover only
  if (item.timeline === "Tomorrow") return "Today";
  if (item.timeline === "Next Week" && dayOfWeek === 1) return "This Week"; // Monday

  return null; // no change
}

export async function runTimelineSync(): Promise<{ updated: number; skipped: number }> {
  const today      = todayPKT();
  const dayOfWeek  = new Date(today + "T12:00:00+05:00").getDay(); // 0=Sun, 1=Mon … 6=Sat

  const items  = await fetchAllItems();
  let updated  = 0;
  let skipped  = 0;

  for (const item of items) {
    const target = computeTargetTimeline(item, today, dayOfWeek);

    // No change needed (null = leave as-is, same value = skip)
    if (target === null || target === item.timeline) {
      skipped++;
      continue;
    }

    try {
      await notionFetch("PATCH", `/pages/${item.id}`, {
        properties: {
          "Timeline": { select: { name: target } },
        },
      });
      console.log(`  ${item.id.slice(0, 8)}  ${item.timeline ?? "(none)"} → ${target}  [${item.status}]`);
      updated++;
    } catch (e) {
      console.error(`  FAILED ${item.id}: ${e}`);
    }

    // Stay under Notion's 3 req/s rate limit
    await new Promise((r) => setTimeout(r, 350));
  }

  console.log(`[timeline_sync] done — updated: ${updated}, skipped: ${skipped}`);
  return { updated, skipped };
}
