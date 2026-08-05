// A proposal carrying front/back is a NEW design; changing a saved one is a different shape
// (2026-08-04, corrected and extended 2026-08-05).
// Run with: node --test scripts/design-edit-guard.test.mjs
//
// REPORTED LIVE, with three traces. Over several turns the user asked to "add picture on the back side
// of this template" and "add the tag line thank you for shopping". The agent fetched the bundle, then
// emitted a TemplateProposal with a completely INVENTED front — "BUILDING YOUR VISION" over a dark
// gradient — and described it as "both sides of the New Builds Construction design". The existing front
// was simply gone, and nothing said so.
//
// The first version of this guard blamed two constraints, and ONE OF THEM WAS WRONG — recorded here
// because the wrong version shipped:
//   * WRONG: "get_template_bundle returns no html, so the model cannot see the design, and a design
//     runs to 10k+ lines anyway." getTemplateBundleById returns the artwork for both sides
//     (data.front_template.html / data.back_template.html); the MCP was throwing it away by choice.
//     And measured against a 44-row dump of the real templates table, a side is 8-16 KB and 35-56
//     LINES — the "10k+ lines" claim was out by ~200x.
//   * RIGHT: a TemplateProposal carrying front/back is a whole design, so a back-only change could not
//     be expressed. Sending one named after an existing design REPLACES it.
// So the agent can now read a side (get_template_side_html) and describe a CHANGE (bundle_id + side +
// ops). The name check below stays, because proposing a whole design under an existing design's name is
// still a replacement dressed as an edit — it just points at the edit path now instead of the editor.
//
// The comparison needs pinning because a bundle has no name of its own: the display name is a side
// template's description minus a trailing " Front"/" Back".
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9999";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
const { designNameClash, mixedProposalModes } = await import("../src/tools-genui.mjs");

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

// ── new design OR edit, never both ───────────────────────────────────────────
// The catalog schema is a union, and validateUiFrame's strip-parity walker resolves a union by
// required-key presence: a payload carrying BOTH matches the new-design branch first, so the `edit`
// half would be silently stripped and the proposal would sail through as a whole new design — the
// reported bug, reintroduced through the back door. Hence a check on the RAW arguments.
test("a proposal carrying BOTH an edit and a full design is refused", () => {
  const got = mixedProposalModes({
    name: "New Builds Construction",
    postcard_size: "6x9",
    front: { elements: [] },
    back: { elements: [] },
    bundle_id: "b1",
    side: "back",
    ops: [{ op: "add" }],
  });
  assert.equal(got?.blocked, "proposal_is_new_or_edit_not_both");
  assert.equal(got.retry, false);
  assert.match(got.note, /get_template_side_html/);
  assert.match(got.note, /NOTHING was rendered/);
});

test("it triggers on a PARTIAL mix too — one side plus a bundle_id is still ambiguous", () => {
  assert.ok(mixedProposalModes({ bundle_id: "b1", side: "back", ops: [], front: { elements: [] } }));
  assert.ok(mixedProposalModes({ ops: [{ op: "remove" }], back: { elements: [] } }));
});

test("a clean edit and a clean new design both pass", () => {
  assert.equal(mixedProposalModes({ bundle_id: "b1", side: "back", ops: [{ op: "add" }] }), null);
  assert.equal(mixedProposalModes({ name: "Fresh", postcard_size: "4x6", front: { elements: [] }, back: { elements: [] } }), null);
});

test("junk never throws", () => {
  for (const bad of [null, undefined, 42, "x", []]) assert.equal(mixedProposalModes(bad), null);
});

test("the word Front inside a real name is not mistaken for the side token", () => {
  // Only a TRAILING side token is stripped, so a design legitimately called "Front Porch Offer" keeps it.
  const lib = [{ id: "b", front: { description: "Front Porch Offer Front" } }];
  assert.equal(designNameClash("Front Porch Offer", lib), "Front Porch Offer");
  assert.equal(designNameClash("Porch Offer", lib), null);
});

// ── the union survives ajv end-to-end (2026-08-05) ───────────────────────────
// TemplateProposal is now two branches. It is also the most union-heavy component in the catalog —
// the strip-parity machinery exists BECAUSE of it — so both branches are exercised through the real
// validateUiFrame, not just asserted about in the abstract.
const { validateUiFrame } = await import("../src/tools-genui.mjs");
const frameWith = (props) => ({
  type: "ui", surface_id: "s1", mode: "replace", root: "p",
  components: [{ id: "p", component: { TemplateProposal: props } }],
  data_model: {},
});

test("an EDIT proposal validates and takes the derived per-side surface id", () => {
  const v = validateUiFrame(frameWith({
    bundle_id: "b1", side: "back",
    ops: [{ op: "set_text", element_id: "el_7", text: "Thank you for shopping", expect_text: "Thanks" }],
    summary: "added the tagline",
  }));
  assert.ok(v.ok, `edit frame rejected: ${v.error}`);
  assert.equal(v.frame.surface_id, "TemplateProposal:b1:back");
  const props = v.frame.components[0].component.TemplateProposal;
  assert.equal(props.ops.length, 1);
  assert.equal(props.ops[0].expect_text, "Thanks", "the verification field must survive stripping");
});

test("a NEW-design proposal still validates exactly as before", () => {
  // The regression that would matter most: the working path must not be disturbed by the union.
  const v = validateUiFrame(frameWith({
    name: "Autumn Gutter Clean", postcard_size: "6x9",
    front: { elements: [{ type: "text", text: "Gutters", x: 10, y: 10, width: 200, height: 40 }] },
    back: { elements: [] },
  }));
  assert.ok(v.ok, `new-design frame rejected: ${v.error}`);
  assert.equal(v.frame.components[0].component.TemplateProposal.name, "Autumn Gutter Clean");
});

test("an incomplete NEW design is still refused — the required-field signal is intact", () => {
  // Making front/back optional to fit edits in would have thrown this away silently.
  const v = validateUiFrame(frameWith({ name: "Half A Design", postcard_size: "6x9" }));
  assert.equal(v.ok, false);
});

test("an unknown key on an edit is stripped, not rejected (zod parity)", () => {
  const v = validateUiFrame(frameWith({
    bundle_id: "b1", side: "front", ops: [{ op: "remove", element_id: "el_2" }], nonsense: "x",
  }));
  assert.ok(v.ok, `stripping failed: ${v.error}`);
  assert.equal("nonsense" in v.frame.components[0].component.TemplateProposal, false);
});

test("an edit with no ops is refused — an empty change is not a change", () => {
  assert.equal(validateUiFrame(frameWith({ bundle_id: "b1", side: "front", ops: [] })).ok, false);
});
