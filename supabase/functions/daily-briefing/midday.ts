import {
  getActiveWorkItems, getDailyStatusPage, fetchComments, fetchItemComments,
  appendBlocks, updateStats, addBriefingPosted, readMorningSection,
} from "./notion.ts";
import { generateMiddaySummary } from "./openai.ts";
import { saveSnapshot, getDeltaFromMorning } from "./snapshots.ts";
import {
  isActiveTeamWork, idleItems, membersWithNoTasks,
  WorkItem, todayPKT, midnightPKT, TEAM,
} from "./utils.ts";
import {
  h2, h3, callout, bullet, deltaBullet, renderSection,
} from "./formatter.ts";
import { TEAM as TEAM_CONFIG } from "./config.ts";

export async function runMidday(): Promise<void> {
  const today    = todayPKT();
  const midnight = midnightPKT();

  // 1. Fetch current active items
  const items = await getActiveWorkItems();
  const activeItems = items.filter(isActiveTeamWork);

  // 2. Delta from morning snapshot
  const { deltas, morningItems } = await getDeltaFromMorning(items);

  // 3. Fetch comments added since midnight PKT
  const activeIds = activeItems.map((it) => it.id);
  const itemComments = await fetchItemComments(activeIds, midnight);

  // 4. Get daily status page + idempotency check
  const pageId        = await getDailyStatusPage();
  const _pageData = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: { "Authorization": `Bearer ${Deno.env.get("NOTION_TOKEN")}`, "Notion-Version": "2022-06-28" },
  }).then((r) => r.json()) as {properties: Record<string, unknown>};
  const _alreadyPosted = ((_pageData.properties?.["Briefings Posted"] as {multi_select?: Array<{name: string}>} | undefined)
    ?.multi_select ?? []).some((x) => x.name === "Mid-day");
  if (_alreadyPosted) { console.log("[midday] already posted today, skipping"); return; }
  const morningExcerpt = await readMorningSection(pageId);
  const pageComments  = await fetchComments(pageId);
  const todayPageComments = pageComments.filter((c) => c.createdTime >= midnight);

  // 5. Generate AI midday summary
  const summary = await generateMiddaySummary({
    morningExcerpt,
    statusChanges:  deltas.statusChanges,
    activeItems,
    itemComments,
    pageComments:   todayPageComments,
  });

  // 6. Smart flags (data-driven, not AI)
  const noTasksNow     = membersWithNoTasks(activeItems);
  const morningNoTask  = membersWithNoTasks(morningItems.filter(isActiveTeamWork));
  const stillNoTask    = noTasksNow.filter((m) => morningNoTask.includes(m));
  const newlyPickedUp  = Object.keys(TEAM_CONFIG).filter(
    (m) => !morningNoTask.includes(m) && !membersWithNoTasks(morningItems.filter(isActiveTeamWork)).includes(m) && noTasksNow.includes(m) === false,
  );
  const idleNow        = idleItems(activeItems, 4);

  // 7. Save midday snapshot
  await saveSnapshot(today, "midday", items);

  // 8. Build blocks
  const blocks: object[] = [];
  blocks.push(h2("☀️ Mid-day Update"));
  blocks.push(callout(summary.headline, "☀️", "yellow_background"));

  // Status changes since morning (data-driven, always shown)
  if (deltas.statusChanges.length) {
    blocks.push(h3("🔄 Since this morning"));
    for (const d of deltas.statusChanges) {
      blocks.push(deltaBullet(d.title, d.from, d.to, d.owner));
    }
  } else {
    blocks.push(h3("🔄 Since this morning"));
    blocks.push(bullet("No status changes yet."));
  }

  // Per-person progress (AI)
  if (summary.progressPerPerson.length) {
    blocks.push(h3("👥 Progress per person"));
    for (const line of summary.progressPerPerson) blocks.push(bullet(line));
  }

  // Shipped / completed
  if (summary.completedToday.length) {
    blocks.push(h3("✅ Completed today"));
    for (const it of summary.completedToday) {
      blocks.push(bullet(it.title, { boldPrefix: it.by, graySuffix: it.status }));
    }
  }

  // Awaiting QA
  if (summary.awaitingQA.length) {
    blocks.push(h3("⏳ Awaiting QA"));
    for (const it of summary.awaitingQA) blocks.push(bullet(it.title));
  }

  // In QA
  if (summary.inQA.length) {
    blocks.push(h3("🔍 In QA"));
    for (const it of summary.inQA) blocks.push(bullet(it.title));
  }

  // Blockers
  if (summary.blockers.length) {
    blocks.push(h3("🚨 Blockers"));
    for (const b of summary.blockers) {
      blocks.push(bullet(b.title, { boldPrefix: b.owner, graySuffix: b.reason }));
    }
  }

  // Kicked back
  if (summary.kickedBack.length) {
    blocks.push(h3("↩️ Kicked back"));
    for (const k of summary.kickedBack) {
      blocks.push(bullet(k.title, { boldPrefix: k.backTo, graySuffix: k.reason }));
    }
  }

  // Smart flags
  if (stillNoTask.length) {
    blocks.push(h3("⚠️ Still no active task"));
    blocks.push(bullet(stillNoTask.join(", ")));
  }

  if (idleNow.length) {
    blocks.push(h3("💤 Idle items (no movement >4h)"));
    for (const it of idleNow) {
      const hrs = Math.round((Date.now() - new Date(it.lastStatusChanged ?? it.createdTime).getTime()) / 3_600_000);
      blocks.push(bullet(it.title, { boldPrefix: it.stageOwner ?? "?", graySuffix: `${hrs}h in ${it.status}` }));
    }
  }

  // 9. Write to Notion
  await appendBlocks(pageId, blocks);
  await updateStats(pageId, {
    shippedToday:  summary.completedToday.filter((c) => c.status === "Shipped").length,
    approvedToday: summary.completedToday.filter((c) => c.status === "Approved").length,
    openBlockers:  summary.blockers.length,
    kickedBack:    summary.kickedBack.length,
  });
  await addBriefingPosted(pageId, "Mid-day");
}
