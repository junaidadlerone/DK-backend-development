// Reading a saved design's artwork: elision, and who may change it (2026-08-05).
// Run with: node --test scripts/template-side-html.test.mjs
//
// The MCP used to project the html out of get_template_bundle and tell the model the artwork was
// unreadable. It is not: getTemplateBundleById returns the full template rows, and the owner pointed
// at the exact keys — data.front_template.html and data.back_template.html. That falsehood is why the
// agent, asked to add a photo to the back of a design, invented a whole new postcard and presented it
// under the existing design's name.
//
// Two decisions had to be right before the html could be handed over, and both are tested here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { designEditability, editabilityNote, elideDataUris } from "../src/template-html.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = join(HERE, "..", "..", "..");
const readSrc = (p) => readFileSync(join(HERE, "..", "src", p), "utf8");

// ── the contract the owner named ─────────────────────────────────────────────
// A code-derived oracle, not a copy of a spec: if the edge function ever stops returning the html,
// or the MCP starts reading a different key, this fails here rather than in front of a user.
test("CONTRACT: getTemplateBundleById returns both sides' full rows, html included", () => {
  const src = readFileSync(join(FUNCTIONS, "getTemplateBundleById", "index.ts"), "utf8");
  assert.match(src, /front_template:\s*frontTemplate/, "the response must carry front_template");
  assert.match(src, /back_template:\s*backTemplate/, "the response must carry back_template");
  // `select("*")` on `templates` is what makes `html` present; a narrowed select would silently
  // empty the edit path.
  assert.match(src, /from\("templates"\)\s*\.select\("\*"\)/s,
    "both sides are fetched with select(\"*\") — narrowing it would drop `html`");
});

test("CONTRACT: the tool reads html off those exact keys", () => {
  const src = readSrc("tools-read.mjs");
  assert.match(src, /get_template_side_html/, "the tool must exist");
  assert.match(src, /front_template\b/);
  assert.match(src, /back_template\b/);
  // …and it must elide before measuring, or a quarter of real designs would be refused on size.
  const tool = src.slice(src.indexOf("get_template_side_html"));
  const elideAt = tool.indexOf("elideDataUris");
  const capAt = tool.indexOf("MAX_SIDE_HTML");
  assert.ok(elideAt > 0 && capAt > elideAt, "the size cap must be applied AFTER elision, not before");
});

// ── elision ──────────────────────────────────────────────────────────────────
const bigPayload = "A".repeat(1_400_000);
const imgTag = (src) => `<img data-element-id="el_1" src="${src}" style="width: 10px;" alt="Image" />`;

test("a base64 payload is replaced by a marker, and the element survives intact", () => {
  const { html, elided } = elideDataUris(imgTag(`data:image/png;base64,${bigPayload}`));
  assert.equal(elided, 1);
  assert.ok(html.length < 300, `expected a small document, got ${html.length}`);
  // Everything the model actually needs is still there: that it is an image, its id, its geometry.
  assert.match(html, /data-element-id="el_1"/);
  assert.match(html, /style="width: 10px;"/);
  // 1,400,000 base64 characters decode to ~1.05 MB, and the marker states the DECODED size.
  assert.match(html, /data:image\/png;base64,ELIDED_1\.0_MB_IMAGE/);
});

test("the reported magnitude: 1.4 MB collapses to a few hundred bytes", () => {
  const before = imgTag(`data:image/png;base64,${bigPayload}`);
  const { html, bytesRemoved } = elideDataUris(before);
  assert.ok(before.length > 1_000_000);
  assert.ok(bytesRemoved > 1_000_000);
  assert.ok(html.length / before.length < 0.001);
});

test("several embedded images are all elided and counted", () => {
  const two = imgTag("data:image/jpeg;base64,QUJD") + imgTag("data:image/png;base64,REVG");
  const { html, elided } = elideDataUris(two);
  assert.equal(elided, 2);
  assert.ok(!/base64,(QUJD|REVG)/.test(html));
});

test("ordinary https images are left completely alone", () => {
  // The common case by far: ~770 bytes an element, nothing to elide.
  const src = imgTag("https://cdn.example.com/roof.jpg");
  const { html, elided } = elideDataUris(src);
  assert.equal(elided, 0);
  assert.equal(html, src);
});

test("a document with no images round-trips unchanged", () => {
  const src = "<div data-element-id=\"t\" data-text-content=\"Hi\">Hi</div>";
  assert.deepEqual(elideDataUris(src), { html: src, elided: 0, bytesRemoved: 0 });
});

test("non-string input never throws", () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    assert.deepEqual(elideDataUris(bad), { html: "", elided: 0, bytesRemoved: 0 });
  }
});

// ── who may edit in place ────────────────────────────────────────────────────
const OWN_ORG = "org_1";
const own = { organization_id: OWN_ORG, is_universal: false };
const shared = { organization_id: "org_agency", is_universal: false };
const universal = { organization_id: null, is_universal: true };

test("an owner or admin may edit their own organization's design", () => {
  for (const role of ["OWNER", "ADMIN", "owner", "admin"]) {
    const v = designEditability({ bundle: own, activeOrgId: OWN_ORG, role });
    assert.equal(v.can_edit_in_place, true, role);
    assert.equal(v.reason, null);
  }
});

test("a universal library design is never editable, whoever asks", () => {
  for (const role of ["OWNER", "ADMIN", "MARKETER", "TECHNICIAN", null]) {
    const v = designEditability({ bundle: universal, activeOrgId: OWN_ORG, role });
    assert.equal(v.can_edit_in_place, false, `role ${role}`);
    assert.equal(v.reason, "universal");
  }
});

test("a design shared in from an agency is not editable, even by an owner", () => {
  // updateTemplateBundleV3 requires OWNER/ADMIN of the OWNING org, so this would 403 at save time —
  // after the user had approved a preview. Deciding it up front is the whole point.
  const v = designEditability({ bundle: shared, activeOrgId: OWN_ORG, role: "OWNER" });
  assert.equal(v.can_edit_in_place, false);
  assert.equal(v.reason, "not_owned");
});

test("marketers and technicians are refused — they cannot reach templates in the app either", () => {
  for (const role of ["MARKETER", "TECHNICIAN"]) {
    const v = designEditability({ bundle: own, activeOrgId: OWN_ORG, role });
    assert.equal(v.can_edit_in_place, false, role);
    assert.equal(v.reason, "role");
  }
});

test("an unknown role fails OPEN, matching roleAreaDenial's posture", () => {
  // Refusing on a failed getUser would break editing for everyone during a lookup hiccup. The card
  // re-checks and the server's own 403 is still the last line.
  const v = designEditability({ bundle: own, activeOrgId: OWN_ORG, role: null });
  assert.equal(v.can_edit_in_place, true);
});

test("ownership is only judged when BOTH ids are known", () => {
  // A missing active org must not be read as "belongs to someone else".
  assert.equal(designEditability({ bundle: own, activeOrgId: null, role: "OWNER" }).can_edit_in_place, true);
  assert.equal(designEditability({ bundle: {}, activeOrgId: OWN_ORG, role: "OWNER" }).can_edit_in_place, true);
});

test("a missing bundle never throws", () => {
  for (const bundle of [null, undefined, {}]) {
    assert.equal(typeof designEditability({ bundle, activeOrgId: OWN_ORG, role: "OWNER" }).can_edit_in_place, "boolean");
  }
});

// ── what the model is told ───────────────────────────────────────────────────
test("when editable, the note forbids sending html back and names the targeting key", () => {
  const note = editabilityNote({ can_edit_in_place: true }, "Spring Roofing");
  assert.match(note, /READING ONLY/);
  assert.match(note, /data-element-id/);
  assert.match(note, /Do NOT send html back/i);
});

test("when NOT editable, the note requires asking BEFORE duplicating", () => {
  // The owner's decision: ask first, then duplicate. A copy the user never agreed to appearing in
  // their library is its own problem.
  const v = designEditability({ bundle: shared, activeOrgId: OWN_ORG, role: "OWNER" });
  const note = editabilityNote(v, "Spring Roofing");
  assert.match(note, /Spring Roofing/);
  assert.match(note, /ASK/);
  assert.match(note, /duplicate_template_bundle/);
  assert.match(note, /Never duplicate without asking first/i);
  assert.match(note, /CANNOT change/);
});
