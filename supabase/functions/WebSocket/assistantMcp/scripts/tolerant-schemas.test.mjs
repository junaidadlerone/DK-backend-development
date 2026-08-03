// Tolerant tool schemas — the two halves of D7 (2026-07-31).
// Run with: node --test scripts/tolerant-schemas.test.mjs
//
// WHY THIS EXISTS
// Every object in a tool's inputSchema — the SDK's own top-level wrapper included — is emitted to
// JSON Schema with `additionalProperties: false`. We are not the consumer of that schema: Flowise
// rebuilds a zod schema from it on its side, where that keyword becomes a strict object which THROWS
// on an extra key, failing the entire tool call before this service is reached and telling the model
// nothing about which key offended. A stray key in a model's tool arguments therefore cost a whole
// turn.
//
// The fix is deliberately two-sided, and this file pins both, because each half alone is a bug:
//   loosenToolSchema  — advertise `additionalProperties: true` at every level, including the
//                       wrapper, so nothing upstream can reject the call.
//   declaredOnly      — re-strip the accepted args against the ORIGINAL shape before the handler
//                       runs. Without this, `.passthrough()` would PRESERVE unknown keys, and
//                       handlers forward sub-objects onward (`body.job_details = {...a.job_details}`),
//                       so a stray key would ride into an edge function that rejects unknown keys
//                       and turn a silently-fine call into a 400.
//
// The assertions below are measurements of the emitted schema, not restatements of the code: they
// convert through the same zod-to-json-schema the MCP SDK uses.
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

// ENV BEFORE ANY src IMPORT. env.mjs snapshots process.env at ITS module load, and static imports
// hoist above every assignment in this file — so tool-helpers (which reaches env.mjs → supabase.mjs)
// must be imported DYNAMICALLY, after these lines. Deliberately not loading .env: CI has none, and a
// test that needs real credentials to run is a test that does not run.
process.env.SUPABASE_URL ??= "http://127.0.0.1:9999";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.SUPABASE_SERVICE_KEY ??= "test-service-role-key";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";

const { declaredOnly, getTurnId, loosenInputSchema, loosenSchema, loosenToolSchema, setTurnId } =
  await import("../src/tool-helpers.mjs");
const { registerWriteTools } = await import("../src/tools-write.mjs");
const { registerReadTools } = await import("../src/tools-read.mjs");
const { registerGenUiTools } = await import("../src/tools-genui.mjs");
const { registerControlTools } = await import("../src/tools-control.mjs");

/** The shape the SDK publishes for a tool: it wraps the raw `{key: ZodType}` shape in z.object(). */
const published = (shape) => zodToJsonSchema(z.object(shape));

/** Collect every `additionalProperties` value at or below a JSON Schema node. */
function collectAdditionalProperties(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) collectAdditionalProperties(n, out);
    return out;
  }
  if (node.type === "object" && "additionalProperties" in node) out.push(node.additionalProperties);
  for (const [k, v] of Object.entries(node)) {
    if (k === "additionalProperties" && typeof v !== "object") continue;
    collectAdditionalProperties(v, out);
  }
  return out;
}

// ── The problem is real: measure it on an un-loosened schema ──────────────────

test("BASELINE: a plain nested z.object publishes additionalProperties:false", () => {
  const schema = published({ home_owner_info: z.object({ name: z.string().optional() }).optional() });
  assert.equal(schema.properties.home_owner_info.additionalProperties, false,
    "if this ever becomes true on its own, D7's advertise half is redundant and can go");
});

// ── loosenSchema: the advertise half ─────────────────────────────────────────

test("loosenSchema flips nested objects to additionalProperties:true", () => {
  const loose = published(loosenInputSchema({
    home_owner_info: z.object({
      name: z.string().optional(),
      address: z.object({ city: z.string().optional() }).optional(),
    }).optional(),
  }));
  const addr = loose.properties.home_owner_info;
  assert.equal(addr.additionalProperties, true);
  assert.equal(addr.properties.address.additionalProperties, true, "must recurse, not just touch the top object");
});

test("loosenSchema reaches objects inside arrays", () => {
  const loose = published(loosenInputSchema({
    items: z.array(z.object({ id: z.string() })).describe("flat array"),
  }));
  assert.equal(loose.properties.items.items.additionalProperties, true);
  assert.equal(loose.properties.items.description, "flat array", "descriptions are what the model reads — keep them");
});

test("loosenSchema preserves optionality, nullability, defaults and array bounds", () => {
  const loose = published(loosenInputSchema({
    maybe: z.object({ a: z.string() }).optional(),
    nullable: z.object({ a: z.string() }).nullable(),
    defaulted: z.object({ a: z.string().optional() }).default({}),
    bounded: z.array(z.object({ a: z.string() })).min(1).max(3),
  }));
  assert.deepEqual(loose.required, ["nullable", "bounded"], "optional/defaulted fields must not become required");
  assert.equal(loose.properties.bounded.minItems, 1);
  assert.equal(loose.properties.bounded.maxItems, 3);
  // A nullable object is emitted as an anyOf/type-union; assert the object branch was loosened.
  assert.ok(collectAdditionalProperties(loose.properties.nullable).includes(true));
});

test("loosenSchema leaves scalars, enums and records untouched", () => {
  const before = { s: z.string(), e: z.enum(["replace"]).optional(), r: z.record(z.any()).optional() };
  assert.deepEqual(published(loosenInputSchema(before)), published(before));
});

test("loosenSchema never throws and never drops a field", () => {
  const weird = { a: z.string(), b: null, c: undefined, d: 42, e: z.object({ x: z.string() }) };
  const out = loosenInputSchema(weird);
  assert.deepEqual(Object.keys(out), Object.keys(weird));
  assert.equal(out.b, null);
  assert.equal(out.d, 42);
  assert.equal(loosenSchema(undefined), undefined);
  assert.equal(loosenSchema({ _def: { typeName: "ZodSomethingNew" } })._def.typeName, "ZodSomethingNew",
    "an unrecognised zod type is returned unchanged, so the worst case is today's strictness");
});

// ── declaredOnly: the execute half ───────────────────────────────────────────

test("declaredOnly strips unknown keys at every level", () => {
  const shape = {
    id: z.string(),
    job_details: z.object({ value: z.number().optional(), job_type: z.object({ name: z.string().optional() }).optional() }).optional(),
  };
  const only = declaredOnly(shape);
  const got = only({
    id: "r1",
    status: "Ready",                                   // the exact key we removed from the schema on purpose
    job_details: { value: 500, currency_code: "USD", job_type: { name: "Roofing", tier: 2 } },
  });
  assert.deepEqual(got, { id: "r1", job_details: { value: 500, job_type: { name: "Roofing" } } });
});

test("declaredOnly is required: the loosened schema alone would let the stray key through", () => {
  const shape = { job_details: z.object({ value: z.number().optional() }).optional() };
  const args = { job_details: { value: 500, currency_code: "USD" } };
  const loosely = z.object(loosenInputSchema(shape)).parse(args);
  assert.equal(loosely.job_details.currency_code, "USD", "passthrough PRESERVES unknown keys — this is the hazard");
  assert.equal(declaredOnly(shape)(args).job_details.currency_code, undefined, "…and this is the guard");
});

test("declaredOnly can only remove keys — it never rejects or replaces the args", () => {
  const only = declaredOnly({ id: z.string() });
  // Wrong type: the SDK would already have rejected this, so fall through untouched rather than
  // silently handing the handler a different object than the one it was called with.
  assert.deepEqual(only({ id: 7 }), { id: 7 });
  assert.deepEqual(declaredOnly(null)({ anything: 1 }), { anything: 1 });
  assert.deepEqual(declaredOnly({ bad: 42 })({ anything: 1 }), { anything: 1 });
});

test("declaredOnly keeps record-typed fields intact (emit_ui props, data_model)", () => {
  const only = declaredOnly({ data_model: z.record(z.any()).optional() });
  const got = only({ data_model: { anyKey: { nested: true } } });
  assert.deepEqual(got.data_model, { anyKey: { nested: true } }, "a record accepts arbitrary keys by design");
});

// ── loosenToolSchema: what registration actually passes to the SDK ───────────
// Handing the SDK a raw {key: ZodType} shape makes IT build the wrapper object, and that wrapper is
// emitted additionalProperties:false — the top level, which is the likeliest place of all for a
// stray key. Only a complete Zod schema lets us own that wrapper.

test("loosenToolSchema loosens the TOP level, which loosenInputSchema cannot reach", () => {
  const shape = { id: z.string() };
  assert.equal(published(shape).additionalProperties, false, "the SDK's own wrapper is strict…");
  assert.equal(published(loosenInputSchema(shape)).additionalProperties, false, "…and loosening fields does not change that");
  assert.equal(zodToJsonSchema(loosenToolSchema(shape)).additionalProperties, true, "loosenToolSchema owns the wrapper");
});

test("loosenToolSchema keeps required/optional and nested loosening intact", () => {
  const emitted = zodToJsonSchema(loosenToolSchema({
    surface_id: z.string(),
    components: z.array(z.object({ id: z.string() })),
    mode: z.enum(["replace"]).optional(),
  }));
  assert.deepEqual(emitted.required, ["surface_id", "components"]);
  assert.equal(emitted.properties.components.items.additionalProperties, true);
  assert.deepEqual(collectAdditionalProperties(emitted).filter((v) => v === false), [], "nothing strict anywhere");
});

test("loosenToolSchema passes non-shapes through untouched", () => {
  assert.equal(loosenToolSchema(null), null);
  assert.equal(loosenToolSchema(undefined), undefined);
  assert.equal(loosenToolSchema("nope"), "nope");
  // A shape with no Zod-typed field at all is a coding error the SDK rejects at registration with a
  // clear message. Hand it through so it still fails loudly instead of registering a broken tool.
  const bad = { nope: 42 };
  assert.equal(loosenToolSchema(bad), bad);
  // An empty shape IS valid (a tool with no parameters) and must still become a passthrough object.
  assert.equal(zodToJsonSchema(loosenToolSchema({})).additionalProperties, true);
});

// ── Wiring: the registries must actually use both halves ─────────────────────

function publishedSchemas(register) {
  const found = new Map();
  const server = { registerTool: (name, config = {}) => found.set(name, config.inputSchema) };
  register(server, { userId: "harness-user", userJwt: "harness-token" });
  return found;
}

// EVERY registry, not just read+write. The original version of this test covered those two only, and
// that gap let `end_task` ship to production as the single strict tool of 64 — found by querying the
// deployed tools/list, which is a check no test was making. A registry missing from this list is
// invisible to the guard, so the list is the thing that matters here.
for (const [label, register] of [
  ["write", registerWriteTools],
  ["read", registerReadTools],
  ["genui", registerGenUiTools],
  ["control", registerControlTools],
]) {
  test(`every ${label} tool advertises additionalProperties:true at every level`, () => {
    const schemas = publishedSchemas(register);
    assert.ok(schemas.size >= 1, `the ${label} registry registered nothing — the guard would pass vacuously`);
    const offenders = [];
    for (const [name, schema] of schemas) {
      // A registry that regressed to a raw shape would fail here too: zodToJsonSchema needs a
      // schema instance, and a raw shape has no _def.
      if (!schema?._def) { offenders.push(`${name} (not a Zod schema — wrap it in loosenToolSchema)`); continue; }
      if (collectAdditionalProperties(zodToJsonSchema(schema)).includes(false)) offenders.push(name);
    }
    assert.deepEqual(offenders, [],
      "wrap the registry's inputSchema in loosenToolSchema — a strict object fails the whole tool call upstream");
  });
}

// ── End-to-end over the real SDK: the two halves together ────────────────────
// The point of the pair is a property the unit tests cannot show on their own: a call carrying a
// stray key at BOTH levels reaches the handler, and the handler sees only declared keys.

test("a stray key at any level survives the wire and is stripped before the handler", async () => {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

  const shape = { id: z.string(), job_details: z.object({ value: z.number().optional() }).optional() };
  const only = declaredOnly(shape);
  let seen = null;
  const server = new McpServer({ name: "d7-probe", version: "0" });
  server.registerTool("probe", { description: "d", inputSchema: loosenToolSchema(shape) },
    async (a) => { seen = only(a); return { content: [{ type: "text", text: "ok" }] }; });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const listed = (await client.listTools()).tools.find((x) => x.name === "probe");
  assert.equal(listed.inputSchema.additionalProperties, true);
  assert.equal(listed.inputSchema.properties.job_details.additionalProperties, true);

  const res = await client.callTool({
    name: "probe",
    arguments: { id: "r1", status: "Ready", job_details: { value: 500, currency_code: "USD" } },
  });
  assert.ok(!res.isError, "the call must not fail on the stray keys");
  assert.deepEqual(seen, { id: "r1", job_details: { value: 500 } });
  await client.close();
});

// ── The turn-correlation header (D5) ─────────────────────────────────────────
// Lives here because setTurnId is part of the same shared plumbing module.

test("setTurnId accepts a UUID and rejects an unsubstituted Flowise variable", () => {
  // If the flow gets the header before the gateway sends the var, Flowise passes the LITERAL
  // "{{$vars.turnId}}" through — logging that as a turn id would look like a real correlation.
  setTurnId("11111111-2222-4333-8444-555555555555");
  assert.equal(getTurnId(), "11111111-2222-4333-8444-555555555555");
  for (const bad of ["{{$vars.turnId}}", "", "   ", "not-a-uuid", null, undefined, 42, "1".repeat(200)]) {
    setTurnId(bad);
    assert.equal(getTurnId(), null, `${JSON.stringify(bad)} must not be recorded as a turn`);
  }
});
