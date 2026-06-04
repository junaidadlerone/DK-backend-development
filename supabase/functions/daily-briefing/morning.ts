import { TEAM, UAT_TESTERS } from "./config.ts";
import {
  getTodayWorkItems, getUATItems, getDailyStatusPage,
  appendBlocks, updateStats, addBriefingPosted, assignWorkItem,
} from "./notion.ts";
import { classifyTask } from "./openai.ts";
import { saveSnapshot } from "./snapshots.ts";
import {
  effectiveOwner, isActiveTeamWork, membersWithNoTasks, WorkItem, todayPKT,
} from "./utils.ts";
import {
  h2, h3, callout, bullet, taskBullet, renderSection,
} from "./formatter.ts";

export async function runMorning(): Promise<void> {
  const today = todayPKT();

  // Idempotency: skip if morning briefing already posted today
  const pageId = await getDailyStatusPage();
  const existingPage = await (async () => {
    const r = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        "Authorization": `Bearer ${Deno.env.get("NOTION_TOKEN")}`,
        "Notion-Version": "2022-06-28",
      },
    });
    return r.json() as Promise<{properties: Record<string, unknown>}>;
  })();
  const alreadyPosted = ((existingPage.properties?.["Briefings Posted"] as {multi_select?: Array<{name: string}>} | undefined)
    ?.multi_select ?? []).some((x) => x.name === "Morning");
  if (alreadyPosted) {
    console.log("[morning] already posted today, skipping");
    return;
  }

  // 1. Fetch today's items
  let items = await getTodayWorkItems();

  // 2. Classify + assign items with no Stage Owner
  const unassigned = items.filter((it) => !it.stageOwner && isActiveTeamWork(it));
  for (const item of unassigned) {
    const { owner, team } = await classifyTask(item);
    await assignWorkItem(item.id, owner, team);
  }
  // Re-fetch if any were assigned
  if (unassigned.length > 0) items = await getTodayWorkItems();

  // 3. Save morning snapshot for delta tracking
  await saveSnapshot(today, "morning", items);

  // 4. Group active items by effective owner
  const activeItems = items.filter(isActiveTeamWork);
  const byOwner = new Map<string, WorkItem[]>();
  for (const item of activeItems) {
    const owner = effectiveOwner(item);
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push(item);
  }

  // 5. Who has zero tasks today
  const noTaskMembers = membersWithNoTasks(activeItems);

  // 6. Newly created tasks (last 24h)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const newTasks = items.filter((it) => it.createdTime >= yesterday);

  // 7. Blocked items
  const blocked = items.filter((it) => it.status === "Blocked");

  // 8. UAT queue — count unique parent stories, not individual sub-tasks
  const uatItems = await getUATItems();
  const readyForUAT = uatItems.filter((it) => it.status === "Ready for UAT");
  const inUAT       = uatItems.filter((it) => it.status === "In UAT");

  // Unique parent count: group sub-tasks under their parent, orphan items count as 1 each
  const countUniqueStories = (items: WorkItem[]) => {
    const seen = new Set<string>();
    for (const it of items) seen.add(it.parentId ?? it.id);
    return seen.size;
  };
  const readyStoriesCount = countUniqueStories(readyForUAT);
  const inUATStoriesCount = countUniqueStories(inUAT);

  // Count per UAT tester (by individual items, not stories)
  const uatCounts: Record<string, number> = {};
  for (const tester of Object.keys(UAT_TESTERS)) uatCounts[tester] = 0;
  for (const it of [...readyForUAT, ...inUAT]) {
    if (it.stageOwner && it.stageOwner in uatCounts) uatCounts[it.stageOwner]++;
  }

  // 9. Build blocks
  const blocks: object[] = [];
  blocks.push(h2("🌅 Morning Briefing"));

  // Executive summary — a few sentences for a quick read
  const criticalItems  = activeItems.filter((it) => it.priority === "Critical");
  const activeTeamCount = Object.keys(TEAM).length - noTaskMembers.length;
  const summaryParts: string[] = [];
  summaryParts.push(`${activeTeamCount} of ${Object.keys(TEAM).length} team members have tasks today.`);
  if (noTaskMembers.length) summaryParts.push(`No tasks: ${noTaskMembers.join(", ")}.`);
  if (criticalItems.length) summaryParts.push(`${criticalItems.length} critical ${criticalItems.length === 1 ? "item" : "items"} in flight.`);
  if (blocked.length) summaryParts.push(`${blocked.length} blocked.`);
  summaryParts.push(`UAT queue: ${readyStoriesCount} ${readyStoriesCount === 1 ? "story" : "stories"} awaiting review.`);
  blocks.push(callout(summaryParts.join("  "), "📋", "gray_background"));

  // Stats callout
  const noTaskNote = noTaskMembers.length
    ? `  No tasks today: ${noTaskMembers.join(", ")}.`
    : "";
  blocks.push(callout(
    `${activeItems.length} active dev/QA task(s) across ${byOwner.size} people.${noTaskNote}`,
    "🌅",
    "blue_background",
  ));

  // Per-person sections (order: Munaf, Nile, Areeb, Zeerak, Junaid, Shahzaib)
  const order = Object.keys(TEAM);
  for (const name of order) {
    const tasks = byOwner.get(name);
    if (!tasks?.length) continue;
    blocks.push(h3(name));
    for (const t of tasks) blocks.push(taskBullet(t.title, t.status, t.priority));
  }

  // Unassigned
  const unassignedTasks = byOwner.get("Unassigned");
  if (unassignedTasks?.length) {
    blocks.push(h3("⚠️ Unassigned"));
    for (const t of unassignedTasks) blocks.push(taskBullet(t.title, t.status, t.priority));
  }

  // Blocked
  if (blocked.length) {
    blocks.push(h3("🚨 Blocked"));
    for (const t of blocked) {
      blocks.push(bullet(t.title, { boldPrefix: t.stageOwner ?? "?", graySuffix: t.blockingReason ?? "No reason given" }));
    }
  }

  // New since yesterday
  if (newTasks.length) {
    blocks.push(h3("🆕 New since yesterday"));
    for (const t of newTasks) blocks.push(bullet(t.title, { graySuffix: t.type }));
  }

  // UAT Summary (story counts, not item counts)
  const uatCountStr = Object.entries(uatCounts).map(([n, c]) => `${n}: ${c}`).join(", ");
  blocks.push(h3("📋 UAT Summary"));
  blocks.push(callout(
    `UAT queue: ${readyStoriesCount} User ${readyStoriesCount === 1 ? "Story" : "Stories"} Ready for UAT · ${inUATStoriesCount} In UAT  (${uatCountStr})`,
    "🧪",
    "purple_background",
  ));

  // 10. Write to Notion (pageId already fetched above for idempotency check)
  await appendBlocks(pageId, blocks);
  await updateStats(pageId, {
    activeDevTasks: activeItems.length,
    uatQueue:       readyStoriesCount + inUATStoriesCount,
  });
  await addBriefingPosted(pageId, "Morning");
}
