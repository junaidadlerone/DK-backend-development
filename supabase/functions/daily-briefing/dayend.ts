import {
  getActiveWorkItems, getUATItems, getDailyStatusPage,
  fetchComments, fetchItemComments, appendBlocks,
  updateStats, addBriefingPosted, readMorningSection,
} from "./notion.ts";
import { generateDayendSummary } from "./openai.ts";
import { saveSnapshot, getDeltaFromMorning, updateProgressLog, getProgressTrend, ProgressStats } from "./snapshots.ts";
import {
  isActiveTeamWork, idleItems, WorkItem, todayPKT, midnightPKT, hoursAgo,
} from "./utils.ts";
import { UAT_SLA_HOURS } from "./config.ts";
import { h2, h3, callout, bullet, deltaBullet } from "./formatter.ts";

export async function runDayend(): Promise<void> {
  const today    = todayPKT();
  const midnight = midnightPKT();

  // 1. Fetch all active + UAT items
  const activeItems = await getActiveWorkItems();
  const uatItems    = await getUATItems();
  const allItems    = [...activeItems, ...uatItems.filter((u) => !activeItems.find((a) => a.id === u.id))];

  // 2. Delta from morning
  const { deltas, morningItems } = await getDeltaFromMorning(allItems);

  // 3. Categorise
  const shipped    = allItems.filter((it) => ["Shipped", "Approved"].includes(it.status));
  const handedToUAT = allItems.filter((it) => it.status === "Ready for UAT" &&
    deltas.statusChanges.some((d) => d.id === it.id && d.to === "Ready for UAT"));
  const inUAT      = allItems.filter((it) => it.status === "In UAT");
  const kickedBack = allItems.filter((it) => ["QA Failed", "UAT Failed"].includes(it.status));
  const inDev      = allItems.filter((it) =>
    ["In Development", "In Design", "Design Review", "Design Handoff"].includes(it.status));
  const awaitingQA = allItems.filter((it) => it.status === "Ready for QA");
  const inQA       = allItems.filter((it) => it.status === "In QA");
  const blocked    = allItems.filter((it) => it.status === "Blocked" || !!it.blockingReason);

  // 4. Fetch comments
  const interestingIds = [...new Set([
    ...shipped, ...kickedBack, ...inDev, ...blocked, ...awaitingQA, ...inQA,
  ].map((it) => it.id))];
  const itemComments = await fetchItemComments(interestingIds, midnight);

  // 5. Status page + idempotency check
  const pageId        = await getDailyStatusPage();
  const _pageData = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: { "Authorization": `Bearer ${Deno.env.get("NOTION_TOKEN")}`, "Notion-Version": "2022-06-28" },
  }).then((r) => r.json()) as {properties: Record<string, unknown>};
  const _alreadyPosted = ((_pageData.properties?.["Briefings Posted"] as {multi_select?: Array<{name: string}>} | undefined)
    ?.multi_select ?? []).some((x) => x.name === "Day-end");
  if (_alreadyPosted) { console.log("[dayend] already posted today, skipping"); return; }
  const morningExcerpt = await readMorningSection(pageId);
  const pageComments  = (await fetchComments(pageId)).filter((c) => c.createdTime >= midnight);

  // 6. Progress metrics
  const totalShipped  = shipped.length;
  const totalUAT      = uatItems.length;
  const totalInDev    = inDev.length;
  const totalBlocked  = blocked.length;
  const totalActive   = activeItems.filter(isActiveTeamWork).length;
  const completionPct = totalShipped + totalActive > 0
    ? +((totalShipped / (totalShipped + totalActive)) * 100).toFixed(1)
    : 0;
  const velocity      = deltas.statusChanges.length;
  const progressTrend = await getProgressTrend();

  // 7. UAT SLA: items sitting in Ready for UAT > SLA hours
  const uatSLA = uatItems.filter(
    (it) => it.status === "Ready for UAT" && hoursAgo(it.lastStatusChanged) > UAT_SLA_HOURS,
  );

  // 8. Bottleneck: any status bucket with >3 items that didn't move today
  const statusBuckets = new Map<string, WorkItem[]>();
  for (const it of activeItems) {
    if (!statusBuckets.has(it.status)) statusBuckets.set(it.status, []);
    statusBuckets.get(it.status)!.push(it);
  }
  const movedIds = new Set(deltas.statusChanges.map((d) => d.id));
  const bottleneck = [...statusBuckets.entries()]
    .filter(([, items]) => items.length > 3 && items.every((it) => !movedIds.has(it.id)))
    .sort(([, a], [, b]) => b.length - a.length)[0];

  // 9. UAT tester breakdown
  const uatByTester: Record<string, number> = {};
  for (const it of inUAT) {
    const n = it.stageOwner ?? "Unassigned";
    uatByTester[n] = (uatByTester[n] ?? 0) + 1;
  }

  // 10. Generate AI summary
  const summary = await generateDayendSummary({
    morningExcerpt,
    statusChanges: deltas.statusChanges,
    shipped, handedToUAT, inUAT, kickedBack,
    inDev, awaitingQA, inQA, blocked,
    itemComments, pageComments,
    progressTrend,
  });

  // 11. Build Notion blocks
  const blocks: object[] = [];
  blocks.push(h2("🌙 Day-end Recap"));
  blocks.push(callout(summary.headline, "🌙", "gray_background"));

  // Per-person summary
  if (summary.perPersonSummary.length) {
    blocks.push(h3("👥 Team Summary"));
    for (const line of summary.perPersonSummary) blocks.push(bullet(line));
  }

  // Shipped
  if (summary.shippedToday.length) {
    blocks.push(h3("✅ Shipped today"));
    for (const it of summary.shippedToday) blocks.push(bullet(it.title, { boldPrefix: it.by }));
  }

  // Handed to UAT
  if (summary.handedToUATToday.length) {
    blocks.push(h3("🧪 Handed to UAT"));
    for (const it of summary.handedToUATToday) blocks.push(bullet(it.title, { boldPrefix: it.from }));
  }

  // Kicked back
  if (summary.kickedBackToday.length) {
    blocks.push(h3("↩️ Kicked back"));
    for (const it of summary.kickedBackToday) {
      blocks.push(bullet(it.title, { boldPrefix: it.backTo, graySuffix: `${it.fromStage}: ${it.reason}` }));
    }
  }

  // Still in progress
  if (summary.stillInProgress.length) {
    blocks.push(h3("🔧 Still in progress"));
    for (const it of summary.stillInProgress) {
      blocks.push(bullet(it.title, { boldPrefix: it.owner, graySuffix: it.status }));
    }
  }

  // Blockers
  if (summary.unresolvedBlockers.length) {
    blocks.push(h3("🚨 Unresolved blockers"));
    for (const b of summary.unresolvedBlockers) {
      blocks.push(bullet(b.title, { boldPrefix: b.owner, graySuffix: b.reason }));
    }
  }

  // Unfinished from morning
  if (summary.unfinishedFromMorning) {
    blocks.push(h3("📌 Unfinished from morning plan"));
    blocks.push(bullet(summary.unfinishedFromMorning));
  }

  // Daily progress metric
  const trendNote = progressTrend ? `  ${progressTrend}` : "";
  blocks.push(h3("📊 Daily Progress"));
  blocks.push(callout(
    `${completionPct}% complete (${totalShipped} shipped of ${totalShipped + totalActive} active) · Velocity: ${velocity} status changes today.${trendNote}`,
    "📊",
    "green_background",
  ));

  // UAT accountability
  const uatTesterSummary = Object.entries(uatByTester).map(([n, c]) => `${n}: ${c} active`).join(" · ") || "No items in UAT";
  blocks.push(h3("⚠️ UAT Accountability"));
  const uatSLANote = uatSLA.length
    ? `  ⏰ ${uatSLA.length} item(s) in Ready for UAT >48h: ${uatSLA.map((it) => it.title).join(", ")}`
    : "";
  blocks.push(callout(
    `${uatTesterSummary}  ·  ${uatItems.filter((it) => it.status === "Ready for UAT").length} waiting in queue.${uatSLANote}`,
    "⚠️",
    "red_background",
  ));

  // Bottleneck
  if (bottleneck) {
    const [status, items] = bottleneck;
    blocks.push(h3("🧱 Bottleneck"));
    blocks.push(bullet(`${items.length} items stuck in "${status}" with no movement today.`));
  }

  // 12. Persist progress log + update Notion
  await saveSnapshot(today, "dayend", allItems);
  await updateProgressLog(today, {
    totalActive, totalShipped, totalUAT, totalInDev, totalBlocked, completionPct, velocity,
  });
  await appendBlocks(pageId, blocks);
  await updateStats(pageId, {
    shippedToday:  shipped.filter((it) => it.status === "Shipped").length,
    approvedToday: shipped.filter((it) => it.status === "Approved").length,
    handedToUAT:   handedToUAT.length,
    openBlockers:  blocked.length,
    kickedBack:    kickedBack.length,
    uatQueue:      uatItems.filter((it) => it.status === "Ready for UAT").length,
  });
  await addBriefingPosted(pageId, "Day-end");
}
