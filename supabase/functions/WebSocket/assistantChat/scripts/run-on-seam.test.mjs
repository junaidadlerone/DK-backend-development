// The run-on defect at tool-return boundaries (D11, 2026-07-31).
// Run with: node --test scripts/run-on-seam.test.mjs
//
// THE BUG: QA reported "…within reach.Let me…" and "…what to go:Launch…" in every multi-sentence
// reply, four rounds running, and a prompt rule asking the model to "always put a space after
// sentence-ending punctuation" never fixed it.
//
// It was never the model's typography. An agent turn is SEVERAL generations — one per tool-calling
// iteration — each streamed as its own `token` frames, and all of them land in the same delta
// accumulator with nothing inserted between them. The last character of iteration N abuts the first
// character of iteration N+1. The model cannot honour a rule about a join it never saw.
//
// These tests drive the REAL chat handler over the replay harness, so they assert the streamed text
// a browser would actually receive. The first is the defect; the rest are the ways this fix must NOT
// misfire, because it runs on every tool return of every turn.
import test from "node:test";
import assert from "node:assert/strict";
import { deltaText, runTurn, startGateway, startMockStack } from "./harness/index.mjs";

let mock;
let gateway;
let token;

test.before(async () => {
  mock = await startMockStack();
  gateway = await startGateway(mock);
  token = await mock.mintToken();
});
test.after(async () => {
  await gateway?.close();
  await mock?.close();
});

const toolReturn = (tool = "search_referrals") => ({
  ev: "usedTools",
  data: [{ tool, toolInput: { query: "Adler One" }, toolOutput: '{"referrals":[{"id":"ref-1"}]}' }],
});

/** Replay `frames` as one turn and return the text the client received. */
async function textFor(frames, message = "look up the Adler One referral") {
  mock.reset();
  mock.setFrames(frames);
  const res = await runTurn(gateway, token, { message, mode: "manual", context: { page: "/referrals" } });
  return { text: deltaText(res.frames), calls: mock.state.predictions.length };
}

test("two generations either side of a tool return are separated, not glued", async () => {
  const { text, calls } = await textFor([
    { ev: "token", data: "Your first campaign is within reach." },
    toolReturn(),
    { ev: "token", data: "The Adler One referral is ready to use." },
  ]);
  assert.equal(calls, 1, "no retry may have fired — that would supply a seam of its own and void this test");
  assert.ok(!/reach\.The/.test(text), `the reported defect is back: ${JSON.stringify(text)}`);
  assert.match(text, /reach\.\n\nThe Adler One referral/);
});

test("a boundary the model DID punctuate is normalized, not doubled", async () => {
  // Intermittency is why this looked flaky: sometimes iteration N+1 opens with its own newlines.
  // The seam swallows the continuation's leading whitespace and inserts exactly one blank line, so
  // the same input produces the same output either way.
  const { text } = await textFor([
    { ev: "token", data: "Your first campaign is within reach." },
    toolReturn(),
    { ev: "token", data: "\n\n\nThe Adler One referral is ready to use." },
  ]);
  assert.match(text, /reach\.\n\nThe Adler One referral/);
  assert.ok(!/\n\n\n/.test(text), `no run of three newlines: ${JSON.stringify(text)}`);
});

test("a tool return before any text never opens the reply with a blank line", async () => {
  const { text } = await textFor([
    toolReturn(),
    { ev: "token", data: "The Adler One referral is ready to use." },
  ]);
  assert.equal(text, text.trimStart(), `reply must not start with whitespace: ${JSON.stringify(text)}`);
  assert.match(text, /^The Adler One referral/);
});

test("a tool return after the last text leaves no trailing blank line", async () => {
  // The common shape for a write turn: the model narrates, then the tool return arrives last. An
  // armed seam that nothing consumes must be invisible.
  const { text } = await textFor([
    { ev: "token", data: "The Adler One referral is ready to use." },
    toolReturn("update_referral"),
  ]);
  assert.equal(text.trimEnd(), "The Adler One referral is ready to use.");
});

test("text within ONE generation is untouched — the fix is scoped to the boundary", async () => {
  // Control: the same two sentences with no tool return between them arrive exactly as sent. If this
  // ever gains a blank line, the seam has started rewriting the model's own prose.
  const { text } = await textFor([
    { ev: "token", data: "Your first campaign is within reach." },
    { ev: "token", data: " The Adler One referral is ready to use." },
  ]);
  assert.equal(text, "Your first campaign is within reach. The Adler One referral is ready to use.");
});

test("several tool returns in a row produce one seam, not one per return", async () => {
  // Both carriers (the `usedTools` event and each node's cumulative agentFlowExecutedData snapshot)
  // report the same return, and arming is a boolean — so duplicates cannot stack up.
  const { text } = await textFor([
    { ev: "token", data: "Looking at both records." },
    toolReturn("search_referrals"),
    toolReturn("get_referral"),
    toolReturn("search_referrals"),
    { ev: "token", data: "Both are ready to use." },
  ]);
  assert.match(text, /records\.\n\nBoth are ready/);
  assert.ok(!/\n\n\n/.test(text), `no stacked seams: ${JSON.stringify(text)}`);
});
