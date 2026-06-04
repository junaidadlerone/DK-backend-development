import OpenAI from "npm:openai@4";
import { STATUS_SEMANTICS } from "./config.ts";
import { WorkItem, Delta, Comment, serialize } from "./utils.ts";

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") ?? "" });

async function chat(system: string, user: string): Promise<string> {
  const res = await openai.chat.completions.create({
    model:       "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user",   content: user   },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
}

function extractJSON(text: string): Record<string, unknown> {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* fall through */ }
  return {};
}

// ─── Task Classification ───────────────────────────────────────────────────

const CLASSIFY_SYSTEM = `
You are a project manager assistant. Given a work item, decide which team member should own it.
Team: Munaf (Design), Nile (Frontend), Areeb (Frontend), Zeerak (Backend), Junaid (Backend/Architect), Shahzaib (QA).
Rules:
- Design work → Munaf
- Frontend UI/UX bugs or features → Nile or Areeb (alternate to balance load)
- Backend APIs, logic, DB → Zeerak or Junaid
- Testing, QA, test cases → Shahzaib
- If ambiguous → Junaid

Return ONLY JSON: {"owner": "<first name>", "team": "<Team Name>"}
Valid team names: Design Team, Frontend Team, Backend Team, QA Team
`.trim();

export async function classifyTask(item: WorkItem): Promise<{ owner: string; team: string }> {
  try {
    const user = `Title: ${item.title}\nType: ${item.type}\nStatus: ${item.status}`;
    const text = await chat(CLASSIFY_SYSTEM, user);
    const parsed = extractJSON(text) as { owner?: string; team?: string };
    if (parsed.owner && parsed.team) return { owner: parsed.owner, team: parsed.team };
  } catch { /* fall through */ }
  return { owner: "Junaid", team: "Backend Team" };
}

// ─── Midday Summary ────────────────────────────────────────────────────────

export interface MiddaySummaryInput {
  morningExcerpt:   string;
  statusChanges:    Delta[];
  activeItems:      WorkItem[];
  itemComments:     Map<string, Comment[]>;
  pageComments:     Comment[];
}

export interface MiddaySummary {
  headline:          string;
  progressPerPerson: string[];
  completedToday:    Array<{ title: string; by: string; status: string }>;
  awaitingQA:        Array<{ title: string }>;
  inQA:              Array<{ title: string }>;
  blockers:          Array<{ title: string; owner: string; reason: string }>;
  kickedBack:        Array<{ title: string; backTo: string; reason: string }>;
}

const MIDDAY_SYSTEM = `
${STATUS_SEMANTICS}

You analyze the midday state of a software team's work items and produce a structured JSON progress report.
Return ONLY valid JSON matching this schema exactly — no markdown fences:
{
  "headline": "one sentence summary of midday state",
  "progressPerPerson": ["Name: one factual sentence about their tasks"],
  "completedToday": [{"title": "...", "by": "first name", "status": "Shipped|Approved"}],
  "awaitingQA": [{"title": "..."}],
  "inQA": [{"title": "..."}],
  "blockers": [{"title": "...", "owner": "first name", "reason": "..."}],
  "kickedBack": [{"title": "...", "backTo": "first name", "reason": "..."}]
}
`.trim();

export async function generateMiddaySummary(input: MiddaySummaryInput): Promise<MiddaySummary> {
  const serialized = input.activeItems.map((it) =>
    serialize(it, input.itemComments.get(it.id) ?? [])
  );
  const pageCommentLines = input.pageComments
    .slice(-5)
    .map((c) => `[${c.createdTime.slice(0, 16)} ${c.authorName}] ${c.text}`);

  const userData = JSON.stringify({
    morning_briefing_excerpt: input.morningExcerpt.slice(0, 1500),
    status_changes_since_morning: input.statusChanges.map((d) =>
      `${d.title}: ${d.from} → ${d.to}${d.owner ? ` (${d.owner})` : ""}`
    ),
    active_items: serialized,
    page_comments_from_lead: pageCommentLines,
  }, null, 2).slice(0, 12_000);

  try {
    const text = await chat(MIDDAY_SYSTEM, `Midday data:\n${userData}`);
    const parsed = extractJSON(text) as Partial<MiddaySummary>;
    return {
      headline:          parsed.headline          ?? "Mid-day check-in.",
      progressPerPerson: parsed.progressPerPerson ?? [],
      completedToday:    parsed.completedToday    ?? [],
      awaitingQA:        parsed.awaitingQA        ?? [],
      inQA:              parsed.inQA              ?? [],
      blockers:          parsed.blockers          ?? [],
      kickedBack:        parsed.kickedBack        ?? [],
    };
  } catch (e) {
    return {
      headline:          `(AI summary failed: ${e})`,
      progressPerPerson: [], completedToday: [], awaitingQA: [],
      inQA: [], blockers: [], kickedBack: [],
    };
  }
}

// ─── Day-End Summary ───────────────────────────────────────────────────────

export interface DayendSummaryInput {
  morningExcerpt:  string;
  statusChanges:   Delta[];
  shipped:         WorkItem[];
  handedToUAT:     WorkItem[];
  inUAT:           WorkItem[];
  kickedBack:      WorkItem[];
  inDev:           WorkItem[];
  awaitingQA:      WorkItem[];
  inQA:            WorkItem[];
  blocked:         WorkItem[];
  itemComments:    Map<string, Comment[]>;
  pageComments:    Comment[];
  progressTrend:   string;
}

export interface DayendSummary {
  headline:              string;
  perPersonSummary:      string[];
  shippedToday:          Array<{ title: string; by: string }>;
  handedToUATToday:      Array<{ title: string; from: string }>;
  kickedBackToday:       Array<{ title: string; fromStage: string; backTo: string; reason: string }>;
  stillInProgress:       Array<{ title: string; owner: string; status: string }>;
  unresolvedBlockers:    Array<{ title: string; owner: string; reason: string }>;
  unfinishedFromMorning: string;
}

const DAYEND_SYSTEM = `
${STATUS_SEMANTICS}

You write a clear end-of-day recap for a software team. Include EVERY item from each input category.
Return ONLY valid JSON matching this schema — no markdown fences:
{
  "headline": "one sentence overall summary",
  "perPersonSummary": ["Name: factual one-sentence day summary"],
  "shippedToday": [{"title": "...", "by": "first name"}],
  "handedToUATToday": [{"title": "...", "from": "first name"}],
  "kickedBackToday": [{"title": "...", "fromStage": "...", "backTo": "first name", "reason": "..."}],
  "stillInProgress": [{"title": "...", "owner": "first name", "status": "..."}],
  "unresolvedBlockers": [{"title": "...", "owner": "first name", "reason": "..."}],
  "unfinishedFromMorning": "1-2 sentences about items from morning plan that didn't move"
}
`.trim();

export async function generateDayendSummary(input: DayendSummaryInput): Promise<DayendSummary> {
  const ser = (items: WorkItem[]) => items.map((it) => serialize(it, input.itemComments.get(it.id) ?? []));
  const pageCommentLines = input.pageComments
    .slice(-5)
    .map((c) => `[${c.createdTime.slice(0, 16)} ${c.authorName}] ${c.text}`);

  const userData = JSON.stringify({
    morning_briefing_excerpt:    input.morningExcerpt.slice(0, 1500),
    status_changes_today:        input.statusChanges.map((d) => `${d.title}: ${d.from} → ${d.to}`),
    shipped_or_approved:         ser(input.shipped),
    handed_to_uat:               ser(input.handedToUAT),
    in_uat:                      ser(input.inUAT),
    kicked_back:                 ser(input.kickedBack),
    in_development_or_design:    ser(input.inDev),
    awaiting_qa:                 ser(input.awaitingQA),
    in_qa:                       ser(input.inQA),
    blocked:                     ser(input.blocked),
    page_comments:               pageCommentLines,
    progress_trend:              input.progressTrend,
  }, null, 2).slice(0, 14_000);

  try {
    const text = await chat(DAYEND_SYSTEM, `Day-end data:\n${userData}`);
    const parsed = extractJSON(text) as Partial<DayendSummary>;
    return {
      headline:              parsed.headline              ?? "Day-end recap.",
      perPersonSummary:      parsed.perPersonSummary      ?? [],
      shippedToday:          parsed.shippedToday          ?? [],
      handedToUATToday:      parsed.handedToUATToday      ?? [],
      kickedBackToday:       parsed.kickedBackToday       ?? [],
      stillInProgress:       parsed.stillInProgress       ?? [],
      unresolvedBlockers:    parsed.unresolvedBlockers    ?? [],
      unfinishedFromMorning: parsed.unfinishedFromMorning ?? "",
    };
  } catch (e) {
    return {
      headline: `(AI summary failed: ${e})`,
      perPersonSummary: [], shippedToday: [], handedToUATToday: [],
      kickedBackToday: [], stillInProgress: [], unresolvedBlockers: [],
      unfinishedFromMorning: "",
    };
  }
}
