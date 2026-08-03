// Every write tool's auto-approve classification, pinned against an explicit table (C8, 2026-07-31).
// Run with: node --test scripts/auto-approve-policy.test.mjs
//
// WHY: the gateway derives its ENTIRE auto-approve policy from these annotations —
//   chat.mjs: readOnlyHint === false && destructiveHint === false  →  "auto" (runs with no card)
//   anything else, or an unknown tool                              →  "confirm"
// So a single wrong annotation silently removes a confirmation prompt in production, and nothing
// fails. The audit found five tools that had done exactly that: two sending live invitation emails,
// two permanently pruning a paid mailing list, and one flipping a paid verification decision.
//
// This is a DECISION TABLE, not a mirror of the code. Adding a write tool without adding it here
// fails the test, which is the point: the classification becomes a deliberate choice rather than a
// default inherited from whichever annotation constant was nearest.
import test from "node:test";
import assert from "node:assert/strict";
import { registerWriteTools } from "../src/tools-write.mjs";

// "auto"    → may run without a card in auto-approve mode (reversible, scoped, no outbound effect)
// "confirm" → must always show an approval card
const EXPECTED = {
  // ── Referrals ──────────────────────────────────────────────────────────────
  create_referral: "auto",
  update_referral: "auto",
  delete_referral: "confirm",          // destructive + cascades to its campaigns
  delete_referral_image: "confirm",    // destructive

  // ── Notifications ──────────────────────────────────────────────────────────
  mark_notification: "auto",
  clear_notification: "auto",       // one notification, archived — cheap and scoped
  // Bulk clear is annotated destructive ON PURPOSE and its own description says to confirm scope:
  // "all" archives every notification in the ORGANIZATION and cannot be undone. The ops playbook
  // used to claim bulk clearing was gate-free; the playbook was wrong and has been corrected —
  // the safer live behaviour stands.
  clear_notifications: "confirm",

  // ── Campaigns ──────────────────────────────────────────────────────────────
  create_campaign: "auto",
  create_address_list_campaign: "auto",
  update_campaign: "auto",
  delete_campaign: "confirm",          // destructive
  set_verification_skip: "confirm",    // flips a PAID address-verification decision
  delete_addresses: "confirm",         // destructive
  remove_invalid_addresses: "confirm", // permanently prunes a paid mailing list
  remove_duplicate_addresses: "confirm",

  // ── Designs / templates ────────────────────────────────────────────────────
  duplicate_template_bundle: "auto",
  update_template_settings: "auto",
  delete_template_bundle: "confirm",   // destructive
  share_agency_template: "confirm",    // changes what OTHER organizations can see
  unshare_agency_template: "confirm",

  // ── Organization / branding / profile ──────────────────────────────────────
  update_organization: "auto",
  update_branding_theme: "auto",
  remove_company_logo: "confirm",      // irreversible file deletion
  update_profile: "auto",
  update_agency_settings: "auto",
  switch_to_agency_account: "confirm", // irreversible, one per account
  set_default_payment_method: "confirm", // billing for the whole organization

  // ── Team / access ──────────────────────────────────────────────────────────
  invite_user: "confirm",              // sends a real email; cannot be un-sent
  edit_user_access: "confirm",         // privilege change
  revoke_user_access: "confirm",       // destructive
};
// NOTE: emit_ui and the read tools are registered by tools-genui.mjs / tools-read.mjs, so they are
// outside this table by design — this test covers the WRITE registry, where a wrong annotation
// removes an approval prompt.

/** Mirrors chat.mjs's derivation exactly. Kept as a literal copy so a drift in either side fails. */
const classify = (annotations = {}) =>
  annotations.readOnlyHint === false && annotations.destructiveHint === false ? "auto" : "confirm";

/** Tools the gateway cards regardless of annotations. Belts, not the primary mechanism. */
const ALWAYS_CONFIRM = new Set([
  "set_default_payment_method", "invite_user", "edit_user_access",
  "share_agency_template", "unshare_agency_template", "set_verification_skip",
  "remove_invalid_addresses", "remove_duplicate_addresses",
]);
const isDeleteBelt = (name) => /^delete_/.test(name);

function collectRegisteredTools() {
  const found = new Map();
  const server = {
    registerTool: (name, config = {}) => found.set(name, config.annotations ?? {}),
  };
  registerWriteTools(server, { userJwt: "harness-token" });
  return found;
}

const registered = collectRegisteredTools();

test("the registry actually registered tools (guards the guard)", () => {
  assert.ok(registered.size >= 25, `expected the write registry to register many tools, got ${registered.size}`);
});

test("every registered write tool has a deliberate entry in this table", () => {
  const undeclared = [...registered.keys()].filter((name) => !(name in EXPECTED));
  assert.deepEqual(
    undeclared,
    [],
    "a new write tool must be classified here on purpose — decide whether it may run without a card",
  );
});

test("this table has no entries for tools that no longer exist", () => {
  const stale = Object.keys(EXPECTED).filter((name) => !registered.has(name));
  assert.deepEqual(stale, [], "remove these from the table (e.g. after a tool is deleted)");
});

test("each tool's EFFECTIVE classification matches the table", () => {
  const wrong = [];
  for (const [name, annotations] of registered) {
    const expected = EXPECTED[name];
    if (!expected) continue; // covered by the undeclared test above
    // Effective policy = annotation-derived, then overridden by the gateway's two belts.
    let actual = classify(annotations);
    if (ALWAYS_CONFIRM.has(name) || isDeleteBelt(name)) actual = "confirm";
    if (actual !== expected) {
      wrong.push(`${name}: expected ${expected}, got ${actual} (annotations: ${JSON.stringify(annotations)})`);
    }
  }
  assert.deepEqual(wrong, [], "an approval prompt would appear or disappear in production");
});

test("nothing with an outbound or irreversible effect is auto-approvable", () => {
  // Stated independently of the table, so a careless edit to EXPECTED cannot quietly allow these.
  const mustConfirm = [
    "invite_user", "edit_user_access", "revoke_user_access", "set_default_payment_method",
    "switch_to_agency_account", "share_agency_template", "unshare_agency_template",
    "set_verification_skip", "remove_invalid_addresses", "remove_duplicate_addresses",
    "remove_company_logo",
  ];
  for (const name of mustConfirm) {
    if (!registered.has(name)) continue;
    let actual = classify(registered.get(name));
    if (ALWAYS_CONFIRM.has(name) || isDeleteBelt(name)) actual = "confirm";
    assert.equal(actual, "confirm", `${name} must always require confirmation`);
  }
});

test("every delete_* tool confirms, whatever its annotations say", () => {
  for (const name of registered.keys()) {
    if (!isDeleteBelt(name)) continue;
    assert.equal(EXPECTED[name], "confirm", `${name} is a delete and must be declared confirm`);
  }
});

test("the assistant no longer registers organization creation or onboarding", () => {
  // Owner scope decision 2026-07-31: onboarding an organization needs an org switch the assistant
  // must not perform, so both tools were removed rather than gated.
  for (const gone of ["create_client_organization", "complete_org_onboarding"]) {
    assert.equal(registered.has(gone), false, `${gone} must not be registered`);
  }
});
