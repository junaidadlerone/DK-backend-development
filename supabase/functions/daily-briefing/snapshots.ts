import { createSupabaseClient } from "../_shared/client.ts";
import { WorkItem, Delta, computeDeltas, todayPKT } from "./utils.ts";

export interface ProgressStats {
  totalActive:   number;
  totalShipped:  number;
  totalUAT:      number;
  totalInDev:    number;
  totalBlocked:  number;
  completionPct: number;
  velocity:      number;
}

export async function saveSnapshot(
  date: string,
  type: "morning" | "midday" | "dayend",
  items: WorkItem[],
): Promise<void> {
  const sb = createSupabaseClient();
  await sb.from("daily_briefing_snapshots").upsert(
    { snapshot_date: date, briefing_type: type, items: items as unknown },
    { onConflict: "snapshot_date,briefing_type" },
  );
}

export async function loadSnapshot(
  date: string,
  type: "morning" | "midday" | "dayend",
): Promise<WorkItem[]> {
  const sb = createSupabaseClient();
  const { data } = await sb
    .from("daily_briefing_snapshots")
    .select("items")
    .eq("snapshot_date", date)
    .eq("briefing_type", type)
    .maybeSingle();
  return (data?.items as WorkItem[]) ?? [];
}

export async function getDeltaFromMorning(currentItems: WorkItem[]): Promise<{
  deltas: ReturnType<typeof computeDeltas>;
  morningItems: WorkItem[];
}> {
  const today = todayPKT();
  const morningItems = await loadSnapshot(today, "morning");
  return { deltas: computeDeltas(morningItems, currentItems), morningItems };
}

export async function updateProgressLog(date: string, stats: ProgressStats): Promise<void> {
  const sb = createSupabaseClient();
  await sb.from("daily_progress_log").upsert(
    {
      log_date:       date,
      total_active:   stats.totalActive,
      total_shipped:  stats.totalShipped,
      total_uat:      stats.totalUAT,
      total_in_dev:   stats.totalInDev,
      total_blocked:  stats.totalBlocked,
      completion_pct: stats.completionPct,
      velocity:       stats.velocity,
      updated_at:     new Date().toISOString(),
    },
    { onConflict: "log_date" },
  );
}

/** Returns a trend sentence comparing today to yesterday. */
export async function getProgressTrend(): Promise<string> {
  const sb = createSupabaseClient();
  const { data } = await sb
    .from("daily_progress_log")
    .select("log_date, completion_pct, velocity")
    .order("log_date", { ascending: false })
    .limit(2);

  if (!data || data.length < 2) return "";
  const [today, yesterday] = data as Array<{ log_date: string; completion_pct: number; velocity: number }>;
  const diff = +(today.completion_pct - yesterday.completion_pct).toFixed(1);
  const dir  = diff > 0 ? `▲ up ${diff}%` : diff < 0 ? `▼ down ${Math.abs(diff)}%` : "flat";
  return `Completion ${dir} vs yesterday (${yesterday.completion_pct}% → ${today.completion_pct}%).`;
}
