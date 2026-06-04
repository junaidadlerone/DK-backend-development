export const WORK_ITEMS_DB = "34fb289c05d38010aabcc40c9737301f";
export const DAILY_STATUSES_DB = "367b289c05d38153bf22d8488942a774";
export const NOTION_VERSION = "2022-06-28";

export const TEAM: Record<string, { id: string; team: string; role: string }> = {
  Munaf:    { id: "360d872b-594c-81f4-b7e0-0002006c1dcc", team: "Design Team",   role: "UI/UX Designer" },
  Nile:     { id: "296d872b-594c-814b-8b8d-0002c0f08128", team: "Frontend Team", role: "Frontend Developer" },
  Areeb:    { id: "2b6d872b-594c-8135-a6c8-00020e72d9d8", team: "Frontend Team", role: "Frontend Developer" },
  Junaid:   { id: "2b6d872b-594c-8151-93bf-0002bfa26014", team: "Backend Team",  role: "Solutions Architect" },
  Zeerak:   { id: "2fdd872b-594c-81b6-aca0-0002ca4e661d", team: "Backend Team",  role: "Backend Developer" },
  Shahzaib: { id: "325d872b-594c-8169-8b82-00024c29c4ee", team: "QA Team",       role: "QA Engineer" },
};

export const UAT_TESTERS: Record<string, string> = {
  Dominic: "295d872b-594c-8185-bf62-0002a4650874",
  Max:     "281d872b-594c-81e9-940b-00023eeaefd0",
};

// All user IDs → first name (for display)
export const USER_ID_TO_NAME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(TEAM).map(([name, v]) => [v.id, name])),
  ...Object.fromEntries(Object.entries(UAT_TESTERS).map(([name, id]) => [id, name])),
};

export const DESIGN_STATUSES   = new Set(["In Design", "Design Review", "Design Handoff"]);
export const QA_STATUSES       = new Set(["Ready for QA", "In QA", "QA Failed"]);
export const UAT_STATUSES      = new Set(["Ready for UAT", "In UAT", "UAT Failed", "Approved"]);
export const DONE_STATUSES     = new Set(["Shipped"]);
export const BLOCKED_STATUSES  = new Set(["Blocked"]);
export const ACTIVE_STATUSES   = new Set([
  "Ready", "In Design", "Design Review", "Design Handoff",
  "In Development", "Blocked",
  "Ready for QA", "In QA", "QA Failed",
  "Ready for UAT", "In UAT", "UAT Failed", "Approved",
]);

// UAT idle SLA: flag items sitting in Ready for UAT longer than this
export const UAT_SLA_HOURS = 48;
// Idle item threshold for midday flag
export const IDLE_HOURS = 4;

export const STATUS_SEMANTICS = `
WORK ITEM STATUS SEMANTICS:
- Backlog: No work started yet.
- Ready: Team member is doing research/scoping.
- In Design: Munaf is building the UI design.
- Design Review: Munaf's design is being reviewed.
- Design Handoff: Design approved, handed to dev team.
- In Development: A dev (Nile/Areeb/Zeerak/Junaid) is building it.
- Blocked: Progress stopped; blocking_reason field has the reason.
- Ready for QA: Dev finished; Shahzaib has NOT started testing yet.
- In QA: Shahzaib is actively testing.
- QA Failed: Shahzaib rejected it; the dev must fix and resubmit.
- Ready for UAT: QA passed; Dominic/Max have NOT started UAT yet.
- In UAT: Dominic or Max is actively running UAT.
- UAT Failed: UAT rejected; the dev must fix.
- Approved: UAT passed; awaiting ship.
- Shipped: Done.

CRITICAL RULE: Stage Owner = the person whose court the ball is in RIGHT NOW.
"Ready for QA" with Stage Owner = Shahzaib means the developer handed it to Shahzaib — Shahzaib has NOT started yet.
DO NOT say someone completed a task unless their status is Shipped or Approved.
DO NOT hallucinate status changes. Only report what the data explicitly says.
Refer to people by first name only. Be concise and factual.
`.trim();
