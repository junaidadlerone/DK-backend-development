// Card-uploaded files appear in the chat, and persist (2026-08-04).
// Run with: node --test scripts/card-attachments.test.mjs
//
// REPORTED: after uploading a photo through the assistant's uploader card, the user's own bubble showed
// only "✓ 1 image uploaded" — no filename, no preview — and the assistant could not name the file either.
//
// Two causes, both structural. The chips render from chat_messages.attachment, which was only ever
// populated by parsing the COMPOSER's text markers; a card uploads straight from the browser, so there is
// no marker and nothing to render. And the card's message to the assistant listed only opaque ids, so it
// had no name to refer to. The card had the File objects and the stored urls in hand and discarded both.
//
// The gateway half is what these tests cover: it now accepts the file metadata from the request body. That
// is CLIENT-SUPPLIED data destined for a persisted `src` attribute, so the sanitising is the point — a
// javascript: or data: url written into the column would be an injection into every later reload of that
// conversation.
import test from "node:test";
import assert from "node:assert/strict";
import { doneFrame, runTurn, startGateway, startMockStack } from "./harness/index.mjs";

let mock;
let gateway;
let token;

test.before(async () => {
  mock = await startMockStack();
  gateway = await startGateway(mock);
  token = await mock.mintToken();
});
test.after(async () => {
  await gateway?.close();
  await mock?.close();
});

/** The attachment array the gateway persisted for the user row, or null. */
async function persistedAttachment(body) {
  mock.reset();
  mock.setFrames([{ ev: "token", data: "Got the photos." }]);
  const res = await runTurn(gateway, token, {
    message: "uploaded", mode: "manual", context: { page: "/referrals" }, ...body,
  });
  assert.equal(res.status, 200);
  assert.ok(doneFrame(res.frames), "the turn must complete");
  const rows = mock.state.restCalls
    .filter((c) => c.path.includes("chat_messages"))
    .flatMap((c) => (Array.isArray(c.body) ? c.body : [c.body]))
    .filter((r) => r?.role === "user");
  return rows.find((r) => r.attachment)?.attachment ?? null;
}

test("a card-supplied file is persisted with its name and url", async () => {
  const got = await persistedAttachment({
    attachment: [{ name: "roof-before.jpg", kind: "image/jpeg", size: 24576, url: "https://cdn.example.com/a.jpg" }],
  });
  assert.deepEqual(got, [{ name: "roof-before.jpg", kind: "image/jpeg", size: 24576, url: "https://cdn.example.com/a.jpg" }]);
});

test("a NON-https url is dropped, and the file still persists", async () => {
  // The url ends up in an <img src> that re-renders on every reload. Anything but https is refused, and
  // the chip degrades to a filename rather than the whole attachment being lost.
  for (const url of [
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "http://cdn.example.com/a.jpg",
    "//cdn.example.com/a.jpg",
    "file:///etc/passwd",
  ]) {
    const got = await persistedAttachment({ attachment: [{ name: "x.jpg", kind: "image/jpeg", size: 10, url }] });
    assert.deepEqual(got, [{ name: "x.jpg", kind: "image/jpeg", size: 10 }], url);
  }
});

test("unknown fields are stripped — only the four we render survive", async () => {
  const got = await persistedAttachment({
    attachment: [{ name: "a.jpg", kind: "image/jpeg", size: 5, url: "https://cdn/x.jpg", evil: "<script>", onerror: "boom", id: "secret" }],
  });
  assert.deepEqual(Object.keys(got[0]).sort(), ["kind", "name", "size", "url"]);
});

test("junk entries are skipped rather than persisted or thrown on", async () => {
  const got = await persistedAttachment({
    attachment: [
      { kind: "image/jpeg", size: 1 },          // no name → unrenderable
      null,
      "not an object",
      { name: "keeper.jpg", kind: "image/jpeg", size: 2 },
    ],
  });
  assert.deepEqual(got, [{ name: "keeper.jpg", kind: "image/jpeg", size: 2 }]);
});

test("a non-array attachment is ignored", async () => {
  for (const attachment of ["nope", 42, {}, true]) {
    assert.equal(await persistedAttachment({ attachment }), null, JSON.stringify(attachment));
  }
});

test("sizes and counts are capped", async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ name: `f${i}.jpg`, kind: "image/jpeg", size: 1 }));
  const got = await persistedAttachment({ attachment: many });
  assert.equal(got.length, 12, "a client cannot make an unbounded row");

  const huge = await persistedAttachment({ attachment: [{ name: "big.jpg", kind: "image/jpeg", size: 9e12 }] });
  assert.ok(huge[0].size <= 5e8, `size not capped: ${huge[0].size}`);

  const longName = await persistedAttachment({ attachment: [{ name: "n".repeat(900), kind: "image/jpeg", size: 1 }] });
  assert.ok(longName[0].name.length <= 200);
});

test("a bad size or kind falls back rather than dropping the file", async () => {
  const got = await persistedAttachment({ attachment: [{ name: "a.jpg", kind: 42, size: "big" }] });
  assert.deepEqual(got, [{ name: "a.jpg", kind: "file", size: 0 }]);
  const negative = await persistedAttachment({ attachment: [{ name: "b.jpg", kind: "image/png", size: -5 }] });
  assert.equal(negative[0].size, 0);
});

test("the COMPOSER path is unchanged, and the two combine", async () => {
  // Text markers are how a paperclip attachment has always travelled; card metadata must add to it, not
  // replace it — one turn can legitimately carry both.
  const marker = await persistedAttachment({ message: "here you go [attachment held in browser: photo.jpg (image, 240KB)]" });
  assert.ok(marker?.some((a) => a.name === "photo.jpg"), `marker path broke: ${JSON.stringify(marker)}`);

  const both = await persistedAttachment({
    message: "here you go [attachment held in browser: photo.jpg (image, 240KB)]",
    attachment: [{ name: "card.jpg", kind: "image/jpeg", size: 10, url: "https://cdn/x.jpg" }],
  });
  assert.deepEqual(both.map((a) => a.name).sort(), ["card.jpg", "photo.jpg"]);
});

test("no attachment at all persists nothing", async () => {
  assert.equal(await persistedAttachment({}), null);
  assert.equal(await persistedAttachment({ attachment: [] }), null);
});
