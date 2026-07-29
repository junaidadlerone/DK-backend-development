// Coverage for tool-helpers.mjs normalizePhone (bug-bash follow-up 2026-07-28).
// Run with: node --test scripts/normalize-phone.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone } from "../src/tool-helpers.mjs";

test("+1 (713) 555-0123 -> +17135550123", () => {
  assert.deepEqual(normalizePhone("+1 (713) 555-0123"), { ok: true, phone: "+17135550123" });
});

test("(214) 555-1234 -> +12145551234", () => {
  assert.deepEqual(normalizePhone("(214) 555-1234"), { ok: true, phone: "+12145551234" });
});

test("2145551234 -> +12145551234", () => {
  assert.deepEqual(normalizePhone("2145551234"), { ok: true, phone: "+12145551234" });
});

test("12145551234 -> +12145551234", () => {
  assert.deepEqual(normalizePhone("12145551234"), { ok: true, phone: "+12145551234" });
});

test("+442071838750 stays unchanged", () => {
  assert.deepEqual(normalizePhone("+442071838750"), { ok: true, phone: "+442071838750" });
});

test("12345 fails (too short)", () => {
  assert.equal(normalizePhone("12345").ok, false);
});

test("555-1234 fails (too short)", () => {
  assert.equal(normalizePhone("555-1234").ok, false);
});

test("+02071838750 fails (leading 0 after +)", () => {
  assert.equal(normalizePhone("+02071838750").ok, false);
});

// "" is handled by the caller (phone stays optional — an empty string is treated as "not
// supplied" and never reaches normalizePhone in tools-write.mjs), but confirm it fails safe here
// too rather than silently validating.
test("empty string fails safe", () => {
  assert.equal(normalizePhone("").ok, false);
});

// Bug-bash 2026-07-28: normalizePhone now requires first digit 2-9 for 10-digit bare
// and second digit 2-9 for 11-digit bare (starting with 1), since no NANP area code
// starts with 0 or 1.
test("0123456789 fails (first digit 0)", () => {
  assert.equal(normalizePhone("0123456789").ok, false);
});

test("1123456789 fails (10 digits starting 1)", () => {
  assert.equal(normalizePhone("1123456789").ok, false);
});

test("10123456789 fails (11 digits, second digit 0)", () => {
  assert.equal(normalizePhone("10123456789").ok, false);
});

test("(214) 555-1234 still works", () => {
  assert.deepEqual(normalizePhone("(214) 555-1234"), { ok: true, phone: "+12145551234" });
});
