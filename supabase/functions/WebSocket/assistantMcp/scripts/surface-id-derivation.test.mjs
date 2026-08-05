// A singleton card's surface_id is derived, not chosen (2026-08-04).
// Run with: node --test scripts/surface-id-derivation.test.mjs
//
// REPORTED LIVE: the audience builder appeared twice in one conversation. The trace showed two
// create_campaign calls with IDENTICAL arguments producing two campaigns, and one emit_ui each:
//   turn A   surface_id "audience-location-zone"          campaign_id 951d214a…
//   turn B   surface_id "audience_builder_location_zone"  campaign_id 97e650fa…
//
// The duplicate campaign is a separate defect (D6's create-once window is 120s and in-memory, which
// cannot span a user pausing to look at what they just made). This file covers the other half: the model
// chose the surface_id from memory of what it had used before, and PARAPHRASED ITSELF.
//
// That matters because surface_id is the key for both dedupe mechanisms — upsertSurface on the frontend
// and the consumed-surface lifecycle (D4) in the gateway. A paraphrase is a brand-new surface, so the
// same logical card renders twice instead of replacing itself. It would do that for a single campaign
// too: any revise can duplicate a card this way.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9999";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
const { derivedSurfaceId, validateUiFrame } = await import("../src/tools-genui.mjs");

const frame = (surface_id, components) => ({
  type: "ui", surface_id, mode: "replace", root: components[0].id, components, data_model: {},
});
const one = (type, props, id = "c1") => [{ id, component: { [type]: props } }];

test("THE REPORTED CASE: two paraphrased ids for one campaign collapse to one surface", () => {
  const a = validateUiFrame(frame("audience-location-zone", one("AudienceBuilder", { campaign_id: "97e650fa" })));
  const b = validateUiFrame(frame("audience_builder_location_zone", one("AudienceBuilder", { campaign_id: "97e650fa" })));
  assert.equal(a.ok, true, a.error);
  assert.equal(b.ok, true, b.error);
  assert.equal(a.frame.surface_id, b.frame.surface_id,
    "the same card for the same campaign must land on ONE surface, whatever the model called it");
  assert.equal(a.frame.surface_id, "AudienceBuilder:97e650fa");
});

test("different campaigns still get different surfaces", () => {
  // The reported conversation genuinely had two campaigns. Two audience builders is the CORRECT
  // rendering of that — collapsing them would hide the duplicate-create bug rather than fix it.
  const a = validateUiFrame(frame("x", one("AudienceBuilder", { campaign_id: "951d214a" })));
  const b = validateUiFrame(frame("x", one("AudienceBuilder", { campaign_id: "97e650fa" })));
  assert.notEqual(a.frame.surface_id, b.frame.surface_id);
});

test("every interactive singleton is keyed on what it acts on", () => {
  const cases = [
    ["AudienceBuilder", { campaign_id: "c1" }, "AudienceBuilder:c1"],
    ["LaunchButton", { campaign_id: "c1", campaign_name: "Spring" }, "LaunchButton:c1"],
    ["VerifyAddressesButton", { campaign_id: "c1", campaign_name: "Spring" }, "VerifyAddressesButton:c1"],
    ["AddressListUploader", { campaign_id: "c1" }, "AddressListUploader:c1"],
    ["OrgSwitchButton", { organization_id: "o1", name: "Acme" }, "OrgSwitchButton:o1"],
    ["ImageUploader", { target: "referral_gallery", referral_id: "r1" }, "ImageUploader:referral_gallery:r1"],
    ["ImageUploader", { target: "company_logo" }, "ImageUploader:company_logo"],
  ];
  for (const [type, props, expected] of cases) {
    const v = validateUiFrame(frame("model-chose-this", one(type, props)));
    assert.equal(v.ok, true, `${type}: ${v.error}`);
    assert.equal(v.frame.surface_id, expected, type);
  }
});

test("a label or seed value does not change the identity", () => {
  // Two emits of the same button with different copy are the same card being revised, not two cards.
  const a = validateUiFrame(frame("a", one("LaunchButton", { campaign_id: "c1", campaign_name: "Spring", label: "Launch" })));
  const b = validateUiFrame(frame("b", one("LaunchButton", { campaign_id: "c1", campaign_name: "Spring", label: "Launch now" })));
  assert.equal(a.frame.surface_id, b.frame.surface_id);
});

test("a CAMPAIGN design proposal replaces in place; a LIBRARY one keeps the model's id", () => {
  const spec = { name: "Winter", postcard_size: "6x9", front: { elements: [] }, back: { elements: [] } };
  const campaign = validateUiFrame(frame("whatever", one("TemplateProposal", { ...spec, campaign_id: "c1" })));
  assert.equal(campaign.frame.surface_id, "TemplateProposal:c1");
  // A library proposal has no target, and the user may legitimately be shown several candidates side by
  // side — so there is nothing intrinsic to derive and the model's id stands.
  const library = validateUiFrame(frame("design-option-2", one("TemplateProposal", spec)));
  assert.equal(library.frame.surface_id, "design-option-2");
});

test("GENERIC blocks keep the model's id — they have no intrinsic identity", () => {
  // A campaign list and a chart are genuinely different surfaces in the same conversation. Forcing ids
  // here would collapse blocks that are supposed to coexist.
  for (const [type, props] of [
    ["Text", { text: "hello" }],
    ["DataTable", { columns: ["a"], rows: [["1"]] }],
    ["StatCards", { items: [{ label: "Sent", value: "12" }] }],
    ["CampaignList", { items: [{ campaignId: "c1", name: "Spring" }] }],
  ]) {
    const v = validateUiFrame(frame("my-own-id", one(type, props)));
    assert.equal(v.ok, true, `${type}: ${v.error}`);
    assert.equal(v.frame.surface_id, "my-own-id", type);
  }
});

test("a frame mixing TWO singletons keeps the model's id", () => {
  // There is no single identity to derive, and picking one arbitrarily would be worse than leaving it.
  const v = validateUiFrame({
    type: "ui", surface_id: "mixed", mode: "replace", root: "col",
    components: [
      { id: "col", component: { Column: { children: ["a", "b"] } } },
      { id: "a", component: { AudienceBuilder: { campaign_id: "c1" } } },
      { id: "b", component: { LaunchButton: { campaign_id: "c1", campaign_name: "Spring" } } },
    ],
    data_model: {},
  });
  assert.equal(v.ok, true, v.error);
  assert.equal(v.frame.surface_id, "mixed");
});

test("a singleton wrapped in a Column still derives, since identity is unambiguous", () => {
  const v = validateUiFrame({
    type: "ui", surface_id: "wrapped", mode: "replace", root: "col",
    components: [
      { id: "col", component: { Column: { children: ["t", "ab"] } } },
      { id: "t", component: { Text: { text: "Pick your audience" } } },
      { id: "ab", component: { AudienceBuilder: { campaign_id: "c9" } } },
    ],
    data_model: {},
  });
  assert.equal(v.frame.surface_id, "AudienceBuilder:c9");
});

test("the override is REPORTED, so the model learns the id is not its to choose", () => {
  const v = validateUiFrame(frame("audience-location-zone", one("AudienceBuilder", { campaign_id: "c1" })));
  assert.equal(v.derivedSurfaceId, "AudienceBuilder:c1");
  assert.equal(v.requestedSurfaceId, "audience-location-zone");
  // No noise when the model happened to send the derived id already.
  const same = validateUiFrame(frame("AudienceBuilder:c1", one("AudienceBuilder", { campaign_id: "c1" })));
  assert.equal(same.derivedSurfaceId, undefined);
});

test("a missing target id falls back to the model's, rather than deriving a colliding stub", () => {
  // AudienceBuilder requires campaign_id, so the catalog refuses it outright; this covers the general
  // rule for any singleton whose identifying prop is absent — never derive "Type:" for everything.
  assert.equal(derivedSurfaceId([{ id: "a", type: "OrgSwitchButton", props: { name: "Acme" } }]), null);
  assert.equal(derivedSurfaceId([{ id: "a", type: "AudienceBuilder", props: { campaign_id: "   " } }]), null);
  assert.equal(derivedSurfaceId([]), null);
  assert.equal(derivedSurfaceId(undefined), null);
});

// ── editing a saved design (2026-08-05) ──────────────────────────────────────
// An edit card is per bundle-SIDE. Revising the edit (the user says "make it bigger") must replace
// the card in place; without this the user is left comparing two versions of one change and can
// approve the stale one.
test("an edit proposal derives its id from the bundle AND the side", () => {
  assert.equal(
    derivedSurfaceId([{ id: "e", type: "TemplateProposal", props: { bundle_id: "b7", side: "back", ops: [] } }]),
    "TemplateProposal:b7:back",
  );
});

test("the two sides of one design are DIFFERENT surfaces", () => {
  const back = derivedSurfaceId([{ id: "e", type: "TemplateProposal", props: { bundle_id: "b7", side: "back", ops: [] } }]);
  const front = derivedSurfaceId([{ id: "e", type: "TemplateProposal", props: { bundle_id: "b7", side: "front", ops: [] } }]);
  assert.notEqual(back, front);
});

test("a campaign proposal still derives from the campaign, and a library one still keeps the model's id", () => {
  // The pre-existing behaviour must be untouched: several candidate designs may be shown at once.
  assert.equal(
    derivedSurfaceId([{ id: "p", type: "TemplateProposal", props: { name: "X", campaign_id: "c3" } }]),
    "TemplateProposal:c3",
  );
  assert.equal(derivedSurfaceId([{ id: "p", type: "TemplateProposal", props: { name: "X" } }]), null);
});
