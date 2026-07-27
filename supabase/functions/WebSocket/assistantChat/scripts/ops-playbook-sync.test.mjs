import test from "node:test";
import assert from "node:assert/strict";
import { splitPlaybook } from "./ops-playbook-sync.mjs";

const SAMPLE = `# Title (INTERNAL)

Preamble line.

---

## Referrals

- referral fact one.

## Cross-cutting gotchas

- gotcha one.
- gotcha two.
`;

test("splits on ## headings, one chunk per section", () => {
  const chunks = splitPlaybook(SAMPLE);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].id, "ops-referrals");
  assert.equal(chunks[1].id, "ops-cross-cutting-gotchas");
});

test("chunk content carries the doc title line + heading + body", () => {
  const [c] = splitPlaybook(SAMPLE);
  assert.match(c.content, /^DoorKnocker\+ agent internal ops — Referrals\n/);
  assert.match(c.content, /referral fact one/);
});

test("slug is stable: lowercase, non-alnum runs become single hyphens", () => {
  const chunks = splitPlaybook("## Campaigns — three types, one wizard\n\nbody");
  assert.equal(chunks[0].id, "ops-campaigns-three-types-one-wizard");
});

test("empty sections are dropped", () => {
  const chunks = splitPlaybook("## A\n\n## B\n\ncontent");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].id, "ops-b");
});
