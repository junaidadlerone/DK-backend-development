// Reading a saved design's artwork, safely (2026-08-05).
//
// Two pure decisions live here so both can be tested without a server, and so the tool that uses
// them stays a thin wrapper around callApi.
//
// BACKGROUND. getTemplateBundleById returns the full `templates` rows, html included
// (data.front_template.html / data.back_template.html). The MCP used to project that away and tell
// the model the artwork was unreadable, which is why — asked to add a photo to the back of a design
// — it invented an entire new postcard and presented it under the existing design's name.
//
// Measured against `supabase/scripts/imports.json`, a 44-row dump of the real templates table:
// a typical side is 8-16 KB and 35-56 lines, comfortably readable. But 11 of those 44 rows are
// 1.4-4.6 MB, because a CROPPED image is stored as an inline base64 data URI (cropImage.ts returns
// canvas.toDataURL and htmlGenerator writes it verbatim into src=). In those rows the base64 is
// 99.4-99.9% of the document; strip it and the structure is 6.5-14 KB like everything else.
//
// So a size cap alone would refuse a QUARTER of all designs. Eliding the payload instead lets the
// model read every design: it needs to know an image element is there and where it sits, never what
// the pixels are, and the browser still holds the real URI when the edit is applied.

/** ~1.33 base64 chars per byte. Good enough for a human-readable size in a marker. */
const humanBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/**
 * Replace every inline base64 payload with a short marker, keeping the element and its attributes
 * intact. Returns the rewritten html plus what was removed, so the caller can tell the model.
 */
export function elideDataUris(html) {
  const src = typeof html === "string" ? html : "";
  let elided = 0;
  let bytesRemoved = 0;
  const out = src.replace(
    /data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g,
    (_m, mime, payload) => {
      elided += 1;
      const bytes = Math.floor((payload.length * 3) / 4);
      bytesRemoved += payload.length;
      return `data:${mime};base64,ELIDED_${humanBytes(bytes).replace(/\s/g, "_")}_IMAGE`;
    },
  );
  return { html: out, elided, bytesRemoved };
}

/**
 * Can the assistant write this side back in place?
 *
 * Mirrors updateTemplateBundleV3's own gates so the model learns the answer BEFORE it proposes an
 * edit, rather than discovering it as a 403 after the user has approved a preview:
 *   - universal (library) designs are platform-admin only;
 *   - the active org must OWN the bundle — a design merely shared in from an agency is not editable;
 *   - the caller must be OWNER or ADMIN of that org. Marketers cannot reach the templates module in
 *     the app at all, so they are refused here too.
 *
 * Fails OPEN on an unknown role, matching roleAreaDenial's documented posture: the server's own auth
 * is still the last line, and refusing on a failed lookup would break editing for everyone whenever
 * getUser hiccups. Ownership and universality come from the bundle itself, so those stay definite.
 */
export function designEditability({ bundle, activeOrgId, role }) {
  const b = bundle ?? {};
  if (b.is_universal) {
    return {
      can_edit_in_place: false,
      reason: "universal",
      plain: "This is one of the built-in library designs, so it can't be changed directly.",
    };
  }
  const owner = b.organization_id ?? null;
  if (owner && activeOrgId && owner !== activeOrgId) {
    return {
      can_edit_in_place: false,
      reason: "not_owned",
      plain: "This design belongs to another organization and was shared with yours, so it can't be changed here.",
    };
  }
  const r = typeof role === "string" ? role.toUpperCase() : null;
  if (r && r !== "OWNER" && r !== "ADMIN") {
    return {
      can_edit_in_place: false,
      reason: "role",
      plain: "Changing a saved design is limited to organization owners and admins.",
    };
  }
  return { can_edit_in_place: true, reason: null, plain: null };
}

/** What the model should do when it cannot edit in place. One place, so the wording cannot drift. */
export function editabilityNote(verdict, name) {
  if (verdict.can_edit_in_place) {
    return (
      "This html is for READING ONLY — it tells you what is on the side and, crucially, each element's "
      + "data-element-id. Do NOT send html back: describe the change as emit_ui TemplateProposal with "
      + "`bundle_id`, `side` and `ops`, targeting elements by their data-element-id. Everything you do "
      + "not name is preserved exactly."
    );
  }
  const label = name ? `"${name}"` : "this design";
  return (
    `You CANNOT change ${label} in place: ${verdict.plain} Do not pretend otherwise and do not send an `
    + `edit for it. Tell the user plainly, then ASK whether they would like their own editable copy `
    + `with the change applied. Only if they say yes: call duplicate_template_bundle, then edit the `
    + `COPY. Never duplicate without asking first — a design they did not ask for appearing in their `
    + `library is its own problem.`
  );
}
