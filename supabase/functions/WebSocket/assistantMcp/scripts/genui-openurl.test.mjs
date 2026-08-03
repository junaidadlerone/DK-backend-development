// An in-app destination is never an openUrl (2026-08-03).
// Run with: node --test scripts/genui-openurl.test.mjs
//
// REPORTED LIVE, with the LangSmith trace of the turn. At the last step of an address-list campaign the
// user asked to verify addresses. The agent correctly said it could not do that itself and offered a
// button — but built a GENERIC Button:
//
//   { componentType: "Button", id: "btn-verify", properties: {
//       action: { type: "openUrl",
//                 url: "https://app.doorknockerplus.com/campaigns/29ffaa3e-…/addresses/verify" },
//       label: "Verify Addresses ($2.55)" } }
//
// That route does not exist (the frontend's only "verif" route is /verify-email). Clicking it opened a
// new tab on a dead page. Two hard rules broken at once: the wrong component — VerifyAddressesButton
// exists for exactly this and opens the in-app modal where the user reviews and pays — and an INVENTED
// url, since the model cannot know the app's routes.
//
// emit_ui ACCEPTED the frame, because a Button with an openUrl action is legal in the catalog. The
// prompt already names the right component for this case and was ignored, so the backstop belongs here.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9999";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
const { checkInAppOpenUrl, validateUiFrame } = await import("../src/tools-genui.mjs");

const frameWith = (action) => ({
  type: "ui", surface_id: "s1", mode: "replace", root: "b",
  components: [{ id: "b", component: { Button: { label: "Verify Addresses ($2.55)", action } } }],
  data_model: {},
});

test("THE REPORTED FRAME is refused, verbatim", () => {
  const v = validateUiFrame(frameWith({
    type: "openUrl",
    url: "https://app.doorknockerplus.com/campaigns/29ffaa3e-3fed-4fda-bbf5-16382127b370/addresses/verify",
  }));
  assert.equal(v.ok, false, "this exact frame reached a user and opened a dead tab");
  assert.match(v.error, /VerifyAddressesButton/, "the refusal must name the component to use instead");
  assert.match(v.error, /invented/, "and say why the url itself was wrong");
});

test("every in-app section is caught, whatever the host", () => {
  // The rule is about the DESTINATION being a screen inside the app, not about the domain — a preview
  // deploy, a custom domain and localhost are all the same mistake.
  for (const url of [
    "https://app.doorknockerplus.com/campaigns/abc/addresses/verify",
    "https://doorknockerplus.com/referrals/xyz",
    "http://localhost:5173/templates/abc",
    "https://dk-preview-123.vercel.app/analytics/overview",
    "https://anything.example.com/settings/branding",
    "https://app.doorknockerplus.com/TARGETING/zones",
  ]) {
    assert.equal(validateUiFrame(frameWith({ type: "openUrl", url })).ok, false, url);
  }
});

test("a GENUINELY external link still works", () => {
  // Not a blanket ban: a receipt or a tracking page that came from tool data is legitimate. Banning
  // openUrl outright would break those to fix this.
  for (const url of [
    "https://dashboard.stripe.com/receipts/abc123",
    "https://postgrid.com/track/xyz",
    "https://help.doorknockerplus.com/articles/verification",
    "https://www.google.com/maps/place/x",
  ]) {
    assert.equal(validateUiFrame(frameWith({ type: "openUrl", url })).ok, true, url);
  }
});

test("send and navigate actions are untouched", () => {
  assert.equal(validateUiFrame(frameWith({ type: "send", prompt: "verify the addresses" })).ok, true);
  // navigate STAYS IN-APP, so it is deliberately not policed here: the route table lives in the
  // frontend and the two services deploy independently, so a stale copy would reject valid paths.
  assert.equal(validateUiFrame(frameWith({ type: "navigate", href: "/campaigns/abc" })).ok, true);
});

test("the purpose-built component renders fine", () => {
  const v = validateUiFrame({
    type: "ui", surface_id: "s1", mode: "replace", root: "v",
    components: [{ id: "v", component: { VerifyAddressesButton: { campaign_id: "29ffaa3e-3fed-4fda-bbf5-16382127b370", campaign_name: "Hundred" } } }],
    data_model: {},
  });
  assert.equal(v.ok, true, `the right answer must validate: ${v.error}`);
});

test("a malformed url is not treated as in-app", () => {
  // The catalog's own pattern rejects these; this must not throw on the way there.
  assert.equal(checkInAppOpenUrl([{ id: "b", props: { action: { type: "openUrl", url: "not a url" } } }]), null);
  assert.equal(checkInAppOpenUrl([{ id: "b", props: { action: { type: "openUrl", url: "" } } }]), null);
  assert.equal(checkInAppOpenUrl([{ id: "b", props: {} }]), null);
  assert.equal(checkInAppOpenUrl(undefined), null);
});

test("the offender is found even when nested among valid components", () => {
  const v = validateUiFrame({
    type: "ui", surface_id: "s1", mode: "replace", root: "col",
    components: [
      { id: "col", component: { Column: { children: ["t", "b"] } } },
      { id: "t", component: { Text: { text: "Ready to verify?" } } },
      { id: "b", component: { Button: { label: "Verify", action: { type: "openUrl", url: "https://app.doorknockerplus.com/campaigns/abc/addresses/verify" } } } },
    ],
    data_model: {},
  });
  assert.equal(v.ok, false);
  assert.match(v.error, /"b"/, "the refusal should name the offending component");
});
