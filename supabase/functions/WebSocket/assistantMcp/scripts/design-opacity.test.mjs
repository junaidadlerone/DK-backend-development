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
const { normalizeSpecOpacity, validateUiFrame } = await import("../src/tools-genui.mjs");

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
