// Control / lifecycle tools — no data access, no side effects (D8, 2026-08-03).
//
// WHAT PROBLEM THIS SOLVES. When a Flowise turn stops, the gateway has no idea WHY. The model may
// have finished, or announced an action and stopped before calling it, or written a tool call as text,
// or be waiting on something only the user can do in the app. Those look identical on the wire — a
// stream that ends — so the gateway currently GUESSES, with a stack of heuristics built one QA report
// at a time: an announce-then-stop nudge with 40 verb stems and 26 vetoes, a cut-off detector, a
// toolless-leak retry, and a referenced-but-never-emitted-UI nudge. Each of them is trying to infer a
// fact the model could simply have stated.
//
// `end_task` lets it state it. One call, at the end, saying how the turn ended.
//
// THE STATUSES ARE DK-SPECIFIC. Nami's three are complete/blocked/waiting (it runs an autonomous loop
// with background jobs). DK+ has no autonomous loop, and its characteristic ending is different: the
// remaining step is one the assistant is not allowed to perform — the consent + signature that
// finalises a referral, the payment and consents that launch a campaign. That is `needs_user_in_app`,
// and it is exactly the case the model used to paper over by claiming the work was done.
//
// PLACEMENT: this MUST be registered in the flow's UNGATED customMCP bundle, so Flowise never emits a
// human-input pause for it. An approval card asking the user to authorise "end the turn" would be
// absurd, and worse, the pause would strand the turn. It is deliberately absent from TOOL_RESOURCES
// (it changes no data, so it dirties no screen) and from the auto-approve decision table (it is not a
// write tool).
//
// NOTHING IS DELETED YET. The heuristics above stay exactly as they are: each was written because QA
// saw the failure it catches, and the model calling this tool reliably is an assumption to MEASURE,
// not to assume. The gateway records what it receives (see the per-turn log's `end_task` field); the
// heuristics get retired on evidence, not on argument.
import { z } from "zod";

const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj) }] });

export function registerControlTools(server, _auth) {
  server.registerTool("end_task", {
    description:
      "End your turn cleanly. Call this ONCE, as your very last action, with the status that matches how the turn actually ended:\n"
      + "• \"complete\" — you finished everything the user asked for, and there is nothing outstanding.\n"
      + "• \"needs_user_in_app\" — you did your part, but the next step is one only the user can do in the app: completing a referral's consent + signature, setting a campaign's mailing audience, or the consents + payment that launch a campaign. Say which, in `summary`.\n"
      + "• \"blocked\" — you cannot continue without a decision or a piece of information only the user can give you. Ask for it in your reply, then call this.\n"
      + "• \"failed\" — something went wrong and the user's request did NOT happen. Never use \"complete\" for this.\n"
      + "This does NOT replace your reply — write your normal answer first, then call this. Do not call it in the middle of a turn: if a step is still doable now, do it instead of ending.",
    inputSchema: {
      status: z
        .enum(["complete", "needs_user_in_app", "blocked", "failed"])
        .describe("complete = nothing outstanding; needs_user_in_app = the rest is the user's to do in the app; blocked = you need something from the user; failed = it did not happen"),
      summary: z
        .string()
        .max(200)
        .optional()
        .describe("one short line: what got done, what the user needs to do, or what went wrong"),
    },
    // readOnlyHint so nothing treats this as a mutation. It never reaches the auto-approve policy
    // anyway: it lives in the UNGATED bundle, so Flowise does not pause on it.
    annotations: { readOnlyHint: true, destructiveHint: false },
  }, async (a) => asText({ ok: true, acknowledged: a?.status ?? "complete" }));
}
