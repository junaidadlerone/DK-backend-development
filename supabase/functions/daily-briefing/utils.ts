import {
  DESIGN_STATUSES, QA_STATUSES, UAT_STATUSES, DONE_STATUSES,
  BLOCKED_STATUSES, TEAM, UAT_TESTERS, USER_ID_TO_NAME,
} from "./config.ts";

export interface WorkItem {
  id: string;
  title: string;
  status: string;
  type: string;
  priority: string;
  severity: string | null;
  timeline: string | null;
  dueDate: string | null;
  assignedTeam: string | null;
  stageOwner: string | null;       // first name
  stageOwnerId: string | null;     // Notion user ID
  blockingReason: string | null;
  lastStatusChanged: string | null;
  createdTime: string;
  parentId: string | null;
  progress: string | null;
}

export interface Comment {
  text: string;
  createdTime: string;
  authorName: string;
}

export interface Delta {
  id: string;
  title: string;
  from: string;
  to: string;
  owner: string | null;
}

export interface DeltaResult {
  statusChanges: Delta[];
  newlyBlocked: WorkItem[];
  newlyAssigned: WorkItem[];  // had no owner in morning, now has one
}

/** Returns whose section this item belongs in for the briefing. */
export function effectiveOwner(item: WorkItem): string {
  const s = item.status;
  if (DESIGN_STATUSES.has(s)) return "Munaf";
  if (QA_STATUSES.has(s))     return "Shahzaib";
  if (UAT_STATUSES.has(s))    return item.stageOwner ?? "UAT";
  return item.stageOwner ?? "Unassigned";
}

/** True if this item is active in-house team work (excludes UAT pipeline, Backlog and Shipped). */
export function isActiveTeamWork(item: WorkItem): boolean {
  if (DONE_STATUSES.has(item.status))  return false;
  if (item.status === "Backlog")        return false;
  // UAT pipeline items belong in the UAT section only
  if (UAT_STATUSES.has(item.status))   return false;
  return true;
}

/** Hours elapsed since an ISO timestamp. */
export function hoursAgo(iso: string | null): number {
  if (!iso) return 0;
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

/** Items that haven't moved in threshold hours and are in an active status. */
export function idleItems(items: WorkItem[], thresholdHours = 4): WorkItem[] {
  return items.filter(
    (it) => isActiveTeamWork(it) && !UAT_STATUSES.has(it.status) && hoursAgo(it.lastStatusChanged) > thresholdHours,
  );
}

/** Compute status changes between two snapshots (keyed by item id). */
export function computeDeltas(morning: WorkItem[], current: WorkItem[]): DeltaResult {
  const morningMap = new Map(morning.map((it) => [it.id, it]));
  const statusChanges: Delta[] = [];
  const newlyBlocked: WorkItem[] = [];
  const newlyAssigned: WorkItem[] = [];

  for (const cur of current) {
    const prev = morningMap.get(cur.id);
    if (!prev) continue;
    if (prev.status !== cur.status) {
      statusChanges.push({ id: cur.id, title: cur.title, from: prev.status, to: cur.status, owner: cur.stageOwner });
      if (BLOCKED_STATUSES.has(cur.status) && !BLOCKED_STATUSES.has(prev.status)) {
        newlyBlocked.push(cur);
      }
    }
    if (!prev.stageOwner && cur.stageOwner) {
      newlyAssigned.push(cur);
    }
  }
  return { statusChanges, newlyBlocked, newlyAssigned };
}

/** Build compact AI-input dict for a work item. */
export function serialize(item: WorkItem, comments: Comment[] = []): Record<string, unknown> {
  return {
    title:              item.title,
    status:             item.status,
    owner:              item.stageOwner ?? "Unassigned",
    type:               item.type,
    priority:           item.priority,
    blocking_reason:    item.blockingReason ?? null,
    hours_in_status:    Math.round(hoursAgo(item.lastStatusChanged)),
    recent_comments:    comments.slice(-3).map((c) => `[${c.createdTime.slice(0, 16)} ${c.authorName}] ${c.text}`),
  };
}

/** Today's date in PKT (UTC+5) as YYYY-MM-DD. */
export function todayPKT(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() + now.getTimezoneOffset() + 300); // shift to PKT
  return now.toISOString().slice(0, 10);
}

/** Start-of-day ISO timestamp in PKT (midnight PKT = 19:00 UTC previous day). */
export function midnightPKT(): string {
  const date = todayPKT();
  // PKT midnight = UTC previous day 19:00
  return new Date(`${date}T00:00:00+05:00`).toISOString();
}

/** Team members (non-UAT) who have no items in the given list. */
export function membersWithNoTasks(items: WorkItem[]): string[] {
  const devTeam = Object.keys(TEAM); // Munaf, Nile, Areeb, Junaid, Zeerak, Shahzaib
  const withTasks = new Set(items.filter(isActiveTeamWork).map(effectiveOwner));
  return devTeam.filter((m) => !withTasks.has(m));
}

/** Resolve a Notion user ID to a first name. */
export function resolveUserName(userId: string | null): string | null {
  if (!userId) return null;
  return USER_ID_TO_NAME[userId] ?? null;
}
