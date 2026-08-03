// Links must be in-app paths that EXIST (2026-08-03).
// Run with: node --test scripts/genui-links.test.mjs
//
// REPORTED LIVE, with the trace. At the final step of an address-list campaign the user asked to verify
// the addresses. The agent correctly said it could not do that itself and offered a button — built as a
// generic Button:
//
//   { componentType: "Button", id: "btn-verify", properties: {
//       action: { type: "openUrl",
//                 url: "https://app.doorknockerplus.com/campaigns/29ffaa3e-…/addresses/verify" },
//       label: "Verify Addresses ($2.55)" } }
//
// The click opened a new tab on a dead page, at the step where the user was about to pay. The model
// invented the ENTIRE url: this app is served from doorknocker.texasgrowthfactory.com and
// door-knocker-plus-dev.vercel.app, and app.doorknockerplus.com is not ours at all.
//
// So the rule is not "check the path" — it is that the agent must never COMPOSE an absolute url, because
// it cannot know the app's hosts. openUrl is refused outright; in-app hrefs are checked against routes
// generated from src/routes/index.tsx.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL ??= "http://127.0.0.1:9999";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
const { checkLinks, pathOf, validateUiFrame } = await import("../src/tools-genui.mjs");

const withAction = (action) => ({
  type: "ui", surface_id: "s1", mode: "replace", root: "b",
  components: [{ id: "b", component: { Button: { label: "Verify Addresses ($2.55)", action } } }],
  data_model: {},
});
const withNav = (href) => ({
  type: "ui", surface_id: "s1", mode: "replace", root: "n",
  components: [{ id: "n", component: { NavButton: { label: "Open", href } } }],
  data_model: {},
});

// ── openUrl: refused outright ────────────────────────────────────────────────

test("THE REPORTED FRAME is refused, verbatim", () => {
  const v = validateUiFrame(withAction({
    type: "openUrl",
    url: "https://app.doorknockerplus.com/campaigns/29ffaa3e-3fed-4fda-bbf5-16382127b370/addresses/verify",
  }));
  assert.equal(v.ok, false, "this exact frame reached a user and opened a dead tab");
  assert.match(v.error, /VerifyAddressesButton/, "the refusal must name the component to use instead");
});

test("openUrl is refused even for the app's REAL hosts", () => {
  // An in-app screen torn out into a new tab bypasses the router and abandons app state, so knowing the
  // real host would not make it right. These hosts are also why a host allowlist was the wrong idea: an
  // earlier attempt allowlisted a domain the MODEL had hallucinated.
  for (const url of [
    "https://doorknocker.texasgrowthfactory.com/campaigns/abc",
    "https://door-knocker-plus-dev.vercel.app/campaigns/abc",
  ]) {
    assert.equal(validateUiFrame(withAction({ type: "openUrl", url })).ok, false, url);
  }
});

test("openUrl is refused for third-party hosts too, and that costs nothing", () => {
  // Checked before deciding this: no tool returns a url that belongs behind a button. website_url is the
  // customer's own site; logo_url and gallery urls are images, which travel in Image.url and are
  // untouched by this rule. So no legitimate case is being given up.
  for (const url of ["https://dashboard.stripe.com/receipts/abc", "https://partner.example.com/campaigns/x"]) {
    assert.equal(validateUiFrame(withAction({ type: "openUrl", url })).ok, false, url);
  }
});

// ── in-app hrefs: checked against the generated routes ───────────────────────

test("a real screen is allowed, including nested and parameterised ones", () => {
  for (const href of [
    "/campaigns",
    "/campaigns/29ffaa3e-3fed-4fda-bbf5-16382127b370",
    "/analytics/campaign-performance",
    "/targeting/zones/z1",
    "/templates/editor/t1",
    "/agency/templates/t1",
    "/settings",
    "/campaigns/abc?tab=audience",
  ]) {
    assert.equal(validateUiFrame(withAction({ type: "navigate", href })).ok, true, href);
  }
});

test("an INVENTED path is refused", () => {
  const v = validateUiFrame(withAction({ type: "navigate", href: "/campaigns/abc/addresses/verify" }));
  assert.equal(v.ok, false);
  assert.match(v.error, /NOT a screen in this app/);
});

test("a real page the assistant is absent from is refused, with a DIFFERENT reason", () => {
  // /login resolves, so "does it exist" is the wrong question — the widget unmounts there, so linking
  // would make the conversation disappear. Two questions, two answers.
  const v = validateUiFrame(withAction({ type: "navigate", href: "/login" }));
  assert.equal(v.ok, false);
  assert.match(v.error, /real page but NOT one to send the user to/);
  assert.ok(!/NOT a screen in this app/.test(v.error), "must not claim the page does not exist");
});

test("NavButton hrefs are held to the same rule", () => {
  assert.equal(validateUiFrame(withNav("/campaigns/abc")).ok, true);
  assert.equal(validateUiFrame(withNav("/campaigns/abc/addresses/verify")).ok, false);
  assert.equal(validateUiFrame(withNav("/pick-organization")).ok, false);
});

test("send actions and the purpose-built components are untouched", () => {
  assert.equal(validateUiFrame(withAction({ type: "send", prompt: "verify the addresses" })).ok, true);
  const v = validateUiFrame({
    type: "ui", surface_id: "s1", mode: "replace", root: "v",
    components: [{ id: "v", component: { VerifyAddressesButton: { campaign_id: "c1", campaign_name: "Hundred" } } }],
    data_model: {},
  });
  assert.equal(v.ok, true, `the right answer must validate: ${v.error}`);
});

test("the offender is named even when nested among valid components", () => {
  const v = validateUiFrame({
    type: "ui", surface_id: "s1", mode: "replace", root: "col",
    components: [
      { id: "col", component: { Column: { children: ["t", "bad"] } } },
      { id: "t", component: { Text: { text: "Ready to verify?" } } },
      { id: "bad", component: { Button: { label: "Verify", action: { type: "openUrl", url: "https://app.doorknockerplus.com/campaigns/abc/addresses/verify" } } } },
    ],
    data_model: {},
  });
  assert.equal(v.ok, false);
  assert.match(v.error, /"bad"/);
});

// ── the oracle itself ────────────────────────────────────────────────────────

test("the routes really came from the router, not a hand-written list", () => {
  // An earlier hand-written version included billing, notifications and the singular
  // campaign/referral/template — none of which are routes. The generated list must contain the awkward
  // nested children a regex misses, and must NOT contain the invented sections.
  for (const href of ["/targeting/exclusions", "/analytics/roi-cost-analytics", "/targeting/zones/create"]) {
    assert.equal(validateUiFrame(withAction({ type: "navigate", href })).ok, true, `${href} is real`);
  }
  for (const href of ["/billing", "/notifications", "/campaign/abc", "/referral/abc"]) {
    assert.equal(validateUiFrame(withAction({ type: "navigate", href })).ok, false, `${href} is not a route`);
  }
});

test("pathOf handles only bare in-app paths", () => {
  assert.equal(pathOf("/campaigns/abc"), "/campaigns/abc");
  assert.equal(pathOf("/campaigns/abc?x=1#y"), "/campaigns/abc");
  assert.equal(pathOf("https://example.com/campaigns"), null, "absolute urls are not in-app hrefs");
  assert.equal(pathOf(""), null);
  assert.equal(pathOf(undefined), null);
});

test("checkLinks tolerates junk without throwing", () => {
  assert.equal(checkLinks(undefined), null);
  assert.equal(checkLinks([]), null);
  assert.equal(checkLinks([{ id: "x", props: {} }]), null);
  assert.equal(checkLinks([{ id: "x" }]), null);
});
