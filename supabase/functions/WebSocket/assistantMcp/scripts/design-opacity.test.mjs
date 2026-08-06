// opacity is a PERCENTAGE, and the model writes CSS fractions (2026-08-03).
// Run with: node --test scripts/design-opacity.test.mjs
//
// REPORTED LIVE, twice. Asked to put a semi-transparent band behind the text so it would read against
// the photos, the agent said it had — "every text element now sits on a 55%-opacity dark band" — and the
// design looked unchanged. The trace showed it had done the job properly:
//
//   front, in paint order:
//     0  shape  888×600            fill=#1D1D20      (base)
//     1  image  0,0                snowy house
//     2  image  444,0              fireplace
//     3  shape  24,45  840×85      opacity=0.55  fill=#1D1D20   ← band, correctly BEFORE the text
//     4  text   40,55              "Don't let the winter catch you cold"
//     5  shape  24,160 840×90      opacity=0.55  fill=#1D1D20   ← band
//     6  text   40,170             "Get 10% off roof repairs"
//     8  shape  200,440 488×70     opacity=0.55  fill=#1D1D20   ← band
//     9  text   216,455            "Call us today"
//
// Right approach, right paint order, right colour, a band behind every text element — and
// `opacity: 0.55` where the schema means a PERCENTAGE. 0.55 validated (the range is 0-100), meaning
// 0.55%, and htmlGenerator emitted `opacity: 0.0055`. Three invisible bands.
//
// Worth being precise about the class: this was NOT an unverified claim. The intent was exactly right
// and the units disagreed silently, so no amount of "only assert what you observed" would have caught
// it. It needed a check on the VALUE.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9999";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
const { normalizeSpecOpacity, validateUiFrame, registerGenUiTools, CATALOG_ARTIFACT } = await import("../src/tools-genui.mjs");

/** The reported spec, reduced to the elements that matter, with the real values from the trace. */
const reportedSpec = () => ({
  name: "Winter Roof Repair",
  postcard_size: "6x9",
  front: {
    elements: [
      { type: "shape", shape: "rectangle", fill: { color: "#1D1D20" }, x: 0, y: 0, width: 888, height: 600 },
      { type: "image", source: { stock_query: "snowy winter house exterior" }, x: 0, y: 0, width: 444, height: 600 },
      { type: "shape", shape: "rectangle", fill: { color: "#1D1D20" }, opacity: 0.55, x: 24, y: 45, width: 840, height: 85 },
      { type: "text", text: "Don't let the winter catch you cold", color: "#FFFFFF", font_size: 42, x: 40, y: 55, width: 808, height: 65 },
      { type: "shape", shape: "rectangle", fill: { color: "#1D1D20" }, opacity: 0.55, x: 24, y: 160, width: 840, height: 90 },
      { type: "text", text: "Get 10% off roof repairs", color: "#FFFFFF", font_size: 28, x: 40, y: 170, width: 808, height: 40 },
    ],
  },
  back: { elements: [{ type: "shape", shape: "rectangle", fill: { color: "#F5F5F5" }, x: 0, y: 0, width: 888, height: 600 }] },
});

const frameOf = (spec) => ({
  type: "ui", surface_id: "design_1", mode: "replace", root: "p",
  components: [{ id: "p", component: { TemplateProposal: spec } }],
  data_model: {},
});

test("THE REPORTED SPEC: 0.55 becomes 55, so the bands are actually visible", () => {
  const spec = reportedSpec();
  const fixed = normalizeSpecOpacity(spec);
  assert.equal(fixed.length, 2, "both bands must be corrected");
  const opacities = spec.front.elements.filter((e) => e.opacity !== undefined).map((e) => e.opacity);
  assert.deepEqual(opacities, [55, 55]);
  for (const f of fixed) assert.match(f, /0\.55 → 55/);
});

test("the whole (0,1] range is treated as a fraction, because 1% is already invisible", () => {
  const spec = { front: { elements: [
    { type: "shape", opacity: 0.5 },
    { type: "shape", opacity: 0.05 },
    { type: "shape", opacity: 1 },      // CSS "fully opaque"; 1% would make it vanish
    { type: "shape", opacity: 0.999 },
  ] } };
  normalizeSpecOpacity(spec);
  assert.deepEqual(spec.front.elements.map((e) => e.opacity), [50, 5, 100, 99.9]);
});

test("a genuine PERCENTAGE is left alone", () => {
  const spec = { front: { elements: [
    { type: "shape", opacity: 55 },
    { type: "shape", opacity: 100 },
    { type: "shape", opacity: 2 },
    { type: "shape", opacity: 1.5 },
  ] } };
  assert.deepEqual(normalizeSpecOpacity(spec), []);
  assert.deepEqual(spec.front.elements.map((e) => e.opacity), [55, 100, 2, 1.5]);
});

test("0 and absent are untouched — deliberately invisible is a choice", () => {
  const spec = { front: { elements: [{ type: "shape", opacity: 0 }, { type: "shape" }] } };
  assert.deepEqual(normalizeSpecOpacity(spec), []);
  assert.equal(spec.front.elements[0].opacity, 0);
  assert.equal(spec.front.elements[1].opacity, undefined);
});

test("junk opacity values do not throw and are not rewritten", () => {
  const spec = { front: { elements: [
    { type: "shape", opacity: "0.55" },
    { type: "shape", opacity: NaN },
    { type: "shape", opacity: null },
    null,
  ] } };
  assert.deepEqual(normalizeSpecOpacity(spec), []);
  assert.equal(normalizeSpecOpacity(null).length, 0);
  assert.equal(normalizeSpecOpacity({}).length, 0);
  assert.equal(normalizeSpecOpacity({ front: {} }).length, 0);
});

test("BOTH sides are corrected, not just the front", () => {
  const spec = { front: { elements: [{ type: "shape", opacity: 0.4 }] }, back: { elements: [{ type: "shape", opacity: 0.6 }] } };
  assert.equal(normalizeSpecOpacity(spec).length, 2);
  assert.equal(spec.front.elements[0].opacity, 40);
  assert.equal(spec.back.elements[0].opacity, 60);
});

// ── through the real frame validator ────────────────────────────────────────

test("the corrected value is what the frame carries downstream", () => {
  // The preview the user sees AND the html baked on approve both come from this frame, so the fix has
  // to land here rather than in the renderer.
  const v = validateUiFrame(frameOf(reportedSpec()));
  assert.equal(v.ok, true, `the frame must still validate: ${v.error}`);
  const els = v.frame.components[0].component.TemplateProposal.front.elements;
  assert.deepEqual(els.filter((e) => e.opacity !== undefined).map((e) => e.opacity), [55, 55]);
});

test("the correction is REPORTED, so the model stops sending fractions", () => {
  const v = validateUiFrame(frameOf(reportedSpec()));
  assert.ok(Array.isArray(v.opacityFixes) && v.opacityFixes.length === 2,
    "silently fixing it would leave the model repeating the mistake and describing the wrong number");
});

test("a spec with correct percentages reports no correction", () => {
  const spec = reportedSpec();
  for (const el of spec.front.elements) if (el.opacity !== undefined) el.opacity = 55;
  const v = validateUiFrame(frameOf(spec));
  assert.equal(v.ok, true);
  assert.equal(v.opacityFixes, undefined);
});

test("paint order is preserved — the bands must stay BEFORE their text", () => {
  // The model got this right and the fix must not disturb it: elements paint in array order
  // (specElementToEditor assigns zIndex: index), so a band after its text would cover the text.
  const v = validateUiFrame(frameOf(reportedSpec()));
  const els = v.frame.components[0].component.TemplateProposal.front.elements;
  const bandIdx = els.findIndex((e) => e.type === "shape" && e.opacity === 55);
  const textIdx = els.findIndex((e) => e.type === "text");
  assert.ok(bandIdx < textIdx, "the band must precede the text it backs");
});

// ── the same units mistake, in gradient stops and in EDIT ops (2026-08-05) ────
// REPORTED LIVE, trace 019fd190. Asked to bring the front's teal-to-orange gradient onto the back of
// "Winter Roof Repair", the model wrote stops at position 0 and position 1. `position` is a PERCENTAGE,
// so that gradient finishes inside its first 1% — a flat orange panel, which is not what it described.
//
// And the original normaliser only walked spec.front/back.elements, so once a proposal could carry
// `ops` instead, everything the agent ADDED to an existing design skipped the correction entirely.
// Both gaps are covered here.
const gradient = (a, b) => ({ gradient: { direction: 90, stops: [{ color: "#47BAD7", position: a }, { color: "#E36A00", position: b }] } });
const stopsOf = (fill) => fill.gradient.stops.map((s) => s.position);

test("THE REPORTED CASE: an edit op's gradient stops 0/1 become 0/100", () => {
  const spec = { bundle_id: "b1", side: "back", ops: [{ op: "set_background", fill: gradient(0, 1) }] };
  const fixed = normalizeSpecOpacity(spec);
  assert.deepEqual(stopsOf(spec.ops[0].fill), [0, 100]);
  assert.equal(fixed.length, 1);
  assert.match(fixed[0], /set_background gradient stops: 0,1 → 0,100/);
});

test("a gradient already in percent is left alone", () => {
  for (const [a, b] of [[0, 100], [0, 50], [10, 90], [0, 2]]) {
    const fill = gradient(a, b);
    assert.equal(normalizeSpecOpacity({ ops: [{ op: "set_background", fill }] }).length, 0, `${a},${b}`);
    assert.deepEqual(stopsOf(fill), [a, b]);
  }
});

test("the test is the LIST maximum, so [0, 50, 100] survives its zero first stop", () => {
  const fill = { gradient: { direction: 0, stops: [{ color: "#000000", position: 0 }, { color: "#888888", position: 50 }, { color: "#FFFFFF", position: 100 }] } };
  assert.equal(normalizeSpecOpacity({ ops: [{ op: "set_background", fill }] }).length, 0);
  assert.deepEqual(stopsOf(fill), [0, 50, 100]);
});

test("a three-stop fractional list scales together", () => {
  const fill = { gradient: { direction: 0, stops: [{ color: "#000000", position: 0 }, { color: "#888888", position: 0.5 }, { color: "#FFFFFF", position: 1 }] } };
  normalizeSpecOpacity({ ops: [{ op: "set_background", fill }] });
  assert.deepEqual(stopsOf(fill), [0, 50, 100]);
});

test("a partly-positioned list is NOT guessed at", () => {
  // Positions are optional in the schema; a list mixing set and unset stops is ambiguous, and a wrong
  // guess there would move a stop the model never mentioned.
  const fill = { gradient: { direction: 0, stops: [{ color: "#000000" }, { color: "#FFFFFF", position: 1 }] } };
  assert.equal(normalizeSpecOpacity({ ops: [{ op: "set_background", fill }] }).length, 0);
  assert.equal(fill.gradient.stops[1].position, 1);
});

test("an ADDED element's opacity is corrected — the gap that let edits through", () => {
  const spec = { bundle_id: "b1", side: "back", ops: [
    { op: "add", element: { type: "shape", shape: "rectangle", fill: { color: "#1D1D20" }, opacity: 0.55, x: 0, y: 0, width: 10, height: 10 } },
  ] };
  const fixed = normalizeSpecOpacity(spec);
  assert.equal(spec.ops[0].element.opacity, 55);
  assert.match(fixed[0], /ops\[0\] add shape opacity: 0\.55 → 55/);
});

test("an added element's gradient FILL is corrected too", () => {
  const spec = { ops: [{ op: "add", element: { type: "shape", shape: "rectangle", fill: gradient(0, 1), x: 0, y: 0, width: 10, height: 10 } }] };
  normalizeSpecOpacity(spec);
  assert.deepEqual(stopsOf(spec.ops[0].element.fill), [0, 100]);
});

test("a NEW design's side background gradient is corrected as well", () => {
  const spec = { front: { background: gradient(0, 1), elements: [] }, back: { elements: [] } };
  normalizeSpecOpacity(spec);
  assert.deepEqual(stopsOf(spec.front.background), [0, 100]);
});

test("a solid fill and a malformed op never throw", () => {
  for (const ops of [[{ op: "set_background", fill: { color: "#ffffff" } }], [null], ["x"], [{ op: "remove", element_id: "e" }], []]) {
    assert.deepEqual(normalizeSpecOpacity({ ops }), []);
  }
  assert.deepEqual(normalizeSpecOpacity({ ops: "nope" }), []);
});

test("the correction reaches the real emit_ui path for an EDIT frame", () => {
  // End to end: the frame the model actually sends, through validateUiFrame, and the fix is REPORTED
  // so the model does not go on to describe the design using the number it sent.
  const v = validateUiFrame({
    type: "ui", surface_id: "s", mode: "replace", root: "p",
    components: [{ id: "p", component: { TemplateProposal: {
      bundle_id: "de7683c4-347d-44b6-ba4d-c5b2598fc0fc", side: "back",
      ops: [{ op: "set_background", fill: gradient(0, 1) }],
    } } }],
    data_model: {},
  });
  assert.ok(v.ok, v.error);
  const stops = v.frame.components[0].component.TemplateProposal.ops[0].fill.gradient.stops;
  assert.deepEqual(stops.map((s) => s.position), [0, 100]);
  assert.ok(v.opacityFixes?.length, "the correction must be reported back to the model");
});

// ── what the model is TOLD about the postcard, not just corrected on (2026-08-06) ─────────────
// REPORTED BY QA: "the back side of the postcard is not created according to the user's request", and
// separately that designs printed a literal {{business_name}}. Both were silence rather than error:
// the model was never told the back has a reserved postal strip that the print service masks WHITE,
// and never told that business_name/phone/website/logo are filled in from the organisation on save.
// These assert the guidance actually reaches the tool description, derived from the artifact.
const emitUiDescription = () => {
  let found = null;
  const server = { registerTool: (name, config = {}) => { if (name === "emit_ui") found = config.description; } };
  registerGenUiTools(server, { userId: "t", userJwt: "t" });
  return found ?? "";
};

test("the emit_ui description states the back's reserved postal area", () => {
  const d = emitUiDescription();
  assert.match(d, /BACK SIDE/);
  assert.match(d, /barcode/i);
  assert.match(d, /MASKS IT WHITE|masked white/i);
});

test("…with the real usable rectangle for every size, taken from the artifact", () => {
  // Derived, never restated: if the app's zones change and the artifact is re-copied, this follows.
  const zones = CATALOG_ARTIFACT.postcard_zones;
  assert.ok(zones, "the artifact must carry postcard_zones — re-run npm run genui:catalog and re-copy");
  const d = emitUiDescription();
  for (const [size, z] of Object.entries(zones)) {
    assert.ok(d.includes(size), `${size} missing from the guidance`);
    assert.ok(d.includes(`x 0-${z.back_art.width}`), `${size} usable width missing from the guidance`);
    // The trap this guards: quoting the CARD's width would tell the model the whole back is safe.
    assert.ok(z.back_art.width < z.document.width, `${size} back area is not narrower than the card`);
  }
});

test("the description explains which merge fields resolve WHEN", () => {
  const d = emitUiDescription();
  assert.match(d, /business_name[^.]*organisation|organisation[^.]*business_name/i);
  assert.match(d, /disclaimer_text/);
  assert.match(d, /qr_url/);
  // The failure mode this prevents: pasting a business name read from the conversation instead of
  // using the variable element, which would bake one org's details into a design for good.
  assert.match(d, /do NOT paste|never paste/i);
});
