// A design proposal is a NEW design, never an edit (2026-08-04).
// Run with: node --test scripts/design-edit-guard.test.mjs
//
// REPORTED LIVE, with three traces. Over several turns the user asked to "add picture on the back side
// of this template" and "add the tag line thank you for shopping". The agent fetched the bundle, then
// emitted a TemplateProposal with a completely INVENTED front — "BUILDING YOUR VISION" over a dark
// gradient — and described it as "both sides of the New Builds Construction design". The existing front
// was simply gone, and nothing said so.
//
// This is not the model misbehaving. It is a capability that does not exist and that the model has no
// way to discover:
//   * get_template_bundle returns NO html on purpose (a design runs to 10k+ lines and would swamp the
//     context), so the model cannot see what is on an existing design;
//   * TemplateProposal requires BOTH sides, so a back-only change cannot be expressed.
// Asked to edit, its only available move was to invent a whole design.
//
// The deterministic tell is the NAME: a proposal named after a design already SAVED in the library is
// the model believing it is editing that design. These tests pin the comparison, because a bundle has no
// name of its own — the display name is a side template's description minus a trailing " Front"/" Back".
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9999";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
const { designNameClash } = await import("../src/tools-genui.mjs");

/** The shape getAllTemplatesBundlesV3 returns: no bundle name, only side descriptions. */
const library = () => ([
  { id: "b1", front: { description: "New Builds Construction Front" }, back: { description: "New Builds Construction Back" } },
  { id: "b2", front: { description: "Spring Roofing Front" }, back: { description: "Spring Roofing Back" } },
  { id: "b3", front_template: { description: "Winter Special front" }, back_template: { description: "Winter Special back" } },
]);

test("THE REPORTED CASE: proposing under a saved design's name is caught", () => {
  assert.equal(designNameClash("New Builds Construction", library()), "New Builds Construction");
});

test("the side token is stripped, in either case and either field shape", () => {
  // "New Builds Construction Front" is the stored description; the display name has no side token.
  assert.equal(designNameClash("Spring Roofing", library()), "Spring Roofing");
  assert.equal(designNameClash("Winter Special", library()), "Winter Special", "front_template/back_template shape");
});

test("comparison survives case and spacing", () => {
  assert.equal(designNameClash("  new   builds CONSTRUCTION ", library()), "new   builds CONSTRUCTION");
});

test("a genuinely NEW name is not blocked", () => {
  // The normal path: the model designs something fresh. It must not be impeded.
  assert.equal(designNameClash("Autumn Gutter Clean", library()), null);
  assert.equal(designNameClash("New Builds Construction v2", library()), null,
    "a differently-named variant is exactly what the refusal asks for, so it must pass");
});

test("no false positive on the revise loop while a proposal is UNSAVED", () => {
  // "Request changes" → re-emit with the same name happens constantly. An unsaved proposal matches
  // nothing in the library, so iteration is untouched.
  assert.equal(designNameClash("Draft Idea", library()), null);
});

test("an empty library never blocks", () => {
  assert.equal(designNameClash("Anything", []), null);
  assert.equal(designNameClash("Anything", null), null);
  assert.equal(designNameClash("Anything", undefined), null);
});

test("an empty or missing proposal name never blocks", () => {
  // The catalog requires a name, so this is belt: never refuse on the basis of a blank.
  for (const n of ["", "   ", null, undefined]) {
    assert.equal(designNameClash(n, library()), null, JSON.stringify(n));
  }
});

test("a bundle with no usable description is skipped, not matched", () => {
  const odd = [{ id: "x" }, { id: "y", front: {} }, { id: "z", front: { description: "" } }];
  assert.equal(designNameClash("Something", odd), null);
  // …and a blank description must never match a blank-ish name either.
  assert.equal(designNameClash("   ", odd), null);
});

test("the word Front inside a real name is not mistaken for the side token", () => {
  // Only a TRAILING side token is stripped, so a design legitimately called "Front Porch Offer" keeps it.
  const lib = [{ id: "b", front: { description: "Front Porch Offer Front" } }];
  assert.equal(designNameClash("Front Porch Offer", lib), "Front Porch Offer");
  assert.equal(designNameClash("Porch Offer", lib), null);
});
