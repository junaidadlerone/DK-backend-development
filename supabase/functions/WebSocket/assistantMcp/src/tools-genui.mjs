// Generative UI — the emit_ui tool.
// The frontend parses a {type:"ui"} SSE frame off the chat stream and renders only
// design-system components validated against genui-catalog.schema.json (GENERATED from the
// frontend's zod catalog — copy from DoorKnockerPlus_Frontend `npm run genui:catalog`, never
// hand-edit). This tool lets the agent render those blocks: it validates the frame server-side
// (ajv), then emits it into a job — the gateway forwards the buffered frame onto the chat SSE.
// The tool's RETURN value is a tiny ack so the (large) UI payload never re-enters the model's
// context.
import { z } from "zod";
import { asText, roleAreaDenial } from "./tool-helpers.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import { createJob, jobEmit, jobComplete } from "./jobs.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const CATALOG = JSON.parse(readFileSync(join(__dir, "genui-catalog.schema.json"), "utf8")).catalog;
const COMPONENT_SCHEMAS = CATALOG.components;
const COMPONENT_TYPES = Object.keys(COMPONENT_SCHEMAS);

// Renderer caps (must match the frontend Surface.tsx).
const MAX_COMPONENTS = 50;
const MAX_DEPTH = 12;
// Components whose `children` arrays hold child component IDs (for depth/cycle checks).
const CONTAINER_KEYS = { Row: "children", Column: "children", Card: "children" };

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = {};
for (const [name, schema] of Object.entries(COMPONENT_SCHEMAS)) validators[name] = ajv.compile(schema);

// ── Validation parity with the frontend (bug-bash 2026-07-24) ─────────────────
// The frontend's zod catalog STRIPS unknown props (no .strict() anywhere) — but the generated
// JSON schema says additionalProperties:false, so ajv REJECTED frames the frontend would have
// rendered fine. Worse, for union-heavy components (TemplateProposal: 38 strict objects, 6
// anyOf) errors[0] was a bare "must NOT have additional properties" with the property name
// dropped, and the model looped retrying blind. Two fixes:
//   1. strip-parity: delete exactly the offending additional properties (ajv names them in
//      params.additionalProperty) and re-validate — mirroring what zod does on render;
//   2. when a frame still fails, report the DEEPEST real errors with property names and
//      allowed values, skipping anyOf/discriminator noise.
// Pick the union branch a value is aimed at: first by a `const` discriminator property
// (elements carry type:"shape"|"text"|…), else by required-key presence (fills: {color} vs
// {gradient}). Null when nothing matches — then we don't strip (validation reports normally).
function pickBranch(branches, value) {
  if (value == null || typeof value !== "object") return null;
  for (const b of branches) {
    const disc = Object.entries(b.properties ?? {}).find(([, s]) => s && s.const !== undefined);
    if (disc && value[disc[0]] === disc[1].const) return b;
  }
  for (const b of branches) {
    const req = b.required ?? [];
    if (req.length && req.every((k) => k in value)) return b;
  }
  return null;
}
// Schema-aware unknown-property strip (zod-parity: the frontend silently drops extras).
// IMPORTANT: naive stripping from ajv's additionalProperties errors is WRONG for unions — the
// non-matching branches flag every branch-specific prop as "additional" and blind deletion
// destroys valid elements. This walker descends the schema, resolves each union to ITS branch,
// and strips only genuinely-unknown keys. Mutates `value` in place.
function stripUnknown(schema, value) {
  if (!schema || value == null || typeof value !== "object") return;
  const branches = schema.oneOf ?? schema.anyOf;
  if (branches) {
    const b = pickBranch(branches, value);
    if (b) stripUnknown(b, value);
    return;
  }
  if (Array.isArray(value)) {
    if (schema.items) for (const item of value) stripUnknown(schema.items, item);
    return;
  }
  const props = schema.properties;
  if (props) {
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in props)) delete value[k];
    }
    for (const [k, sub] of Object.entries(props)) if (k in value) stripUnknown(sub, value[k]);
  }
}
function formatErrors(errors) {
  const real = (errors ?? []).filter((e) =>
    e.keyword !== "anyOf" && e.keyword !== "oneOf" &&
    !(e.keyword === "const" && /\/type$/.test(e.instancePath)) &&
    !(e.keyword === "enum" && /\/type$/.test(e.instancePath)));
  const pool = real.length ? real : (errors ?? []);
  // Union noise: several branches report "required" at the same path — fold them into one line.
  const requiredByPath = new Map();
  const rest = [];
  for (const e of pool) {
    if (e.keyword === "required" && e.params?.missingProperty) {
      const set = requiredByPath.get(e.instancePath) ?? new Set();
      set.add(e.params.missingProperty);
      requiredByPath.set(e.instancePath, set);
    } else {
      rest.push(e);
    }
  }
  const lines = [];
  for (const [path, propsSet] of requiredByPath) {
    const names = [...propsSet];
    lines.push(`${path || "(root)"} is missing ${names.length > 1 ? `one of: ${names.join(" | ")}` : `required property "${names[0]}"`}`);
  }
  for (const e of rest) {
    let msg = `${e.instancePath || "(root)"} ${e.message}`;
    if (e.params?.additionalProperty) msg += ` ("${e.params.additionalProperty}" is not a valid property here — remove it)`;
    if (e.params?.allowedValues) msg += ` (allowed: ${e.params.allowedValues.join(", ")})`;
    lines.push(msg);
  }
  return lines
    .sort((a, b) => b.indexOf(" ") - a.indexOf(" ")) // deepest paths first (longer pointer prefix)
    .slice(0, 3)
    .join("; ") || "invalid props";
}
// Validate one component's props with frontend strip-parity.
// Returns { ok:true, props } (possibly stripped) or { ok:false, error }.
function validateComponentProps(type, props) {
  const validate = validators[type];
  if (validate(props)) return { ok: true, props };
  const work = JSON.parse(JSON.stringify(props));
  stripUnknown(COMPONENT_SCHEMAS[type], work);
  if (validate(work)) return { ok: true, props: work };
  return { ok: false, error: formatErrors(validate.errors) };
}

// Normalize both accepted wire forms into { id, type, props }.
function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = entry.id;
  if (typeof id !== "string" || !id) return { error: "component entry missing string id" };
  if (entry.component && typeof entry.component === "object") {
    const keys = Object.keys(entry.component);
    if (keys.length !== 1) return { error: `component "${id}" must wrap exactly one type` };
    return { id, type: keys[0], props: entry.component[keys[0]] ?? {} };
  }
  if (typeof entry.componentType === "string") {
    return { id, type: entry.componentType, props: entry.properties ?? {} };
  }
  return { error: `component "${id}" has no component/componentType` };
}

// Validate a full frame. Returns { ok:true, frame } or { ok:false, error }.
export function validateUiFrame(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "frame must be an object" };
  const surface_id = input.surface_id;
  if (typeof surface_id !== "string" || !surface_id) return { ok: false, error: "surface_id (string) is required" };
  const root = input.root;
  if (typeof root !== "string" || !root) return { ok: false, error: "root (component id) is required" };
  const mode = input.mode ?? "replace";
  if (mode !== "replace") return { ok: false, error: `mode must be "replace" (patch is reserved)` };
  if (!Array.isArray(input.components) || input.components.length === 0) return { ok: false, error: "components must be a non-empty array" };
  if (input.components.length > MAX_COMPONENTS) return { ok: false, error: `too many components (${input.components.length} > ${MAX_COMPONENTS})` };

  const byId = new Map();
  const normalized = [];
  for (const entry of input.components) {
    const n = normalizeEntry(entry);
    if (!n || n.error) return { ok: false, error: n?.error ?? "invalid component entry" };
    if (byId.has(n.id)) return { ok: false, error: `duplicate component id "${n.id}"` };
    if (!COMPONENT_TYPES.includes(n.type)) return { ok: false, error: `unknown component type "${n.type}" (id "${n.id}")` };
    byId.set(n.id, n);
    normalized.push(n);
  }
  if (!byId.has(root)) return { ok: false, error: `root "${root}" is not among the components` };

  // Per-component prop validation against the catalog schema (strip-parity with the frontend:
  // unknown extra properties are removed, not fatal — see validateComponentProps).
  for (const n of normalized) {
    const result = validateComponentProps(n.type, n.props);
    if (!result.ok) {
      return { ok: false, error: `${n.type} "${n.id}": ${result.error}` };
    }
    n.props = result.props;
  }

  // Referential integrity + depth + cycle check from root.
  const walk = (id, depth, path) => {
    if (depth > MAX_DEPTH) return `nesting exceeds ${MAX_DEPTH} at "${id}"`;
    if (path.has(id)) return `cycle detected at "${id}"`;
    const n = byId.get(id);
    if (!n) return `referenced component "${id}" does not exist`;
    const childKey = CONTAINER_KEYS[n.type];
    if (childKey) {
      const kids = n.props?.[childKey];
      if (Array.isArray(kids)) {
        const nextPath = new Set(path); nextPath.add(id);
        for (const k of kids) {
          const err = walk(k, depth + 1, nextPath);
          if (err) return err;
        }
      }
    }
    return null;
  };
  const err = walk(root, 1, new Set());
  if (err) return { ok: false, error: err };

  return {
    ok: true,
    frame: {
      type: "ui",
      surface_id,
      mode: "replace",
      root,
      // Always emit the canonical/preferred wire form {id, component:{Type:props}}
      // regardless of which form the model produced — the frontend prefers this one.
      components: normalized.map((n) => ({ id: n.id, component: { [n.type]: n.props } })),
      data_model: (input.data_model && typeof input.data_model === "object") ? input.data_model : {},
    },
  };
}

export function registerGenUiTools(server, { userId, userJwt }) {
  server.registerTool("emit_ui", {
    description:
      "Render a rich UI block in the chat (design-system components) instead of plain prose. Use when a block genuinely beats text: campaign/referral/template lists, a targeting-zone map, metric tiles, readiness checklists, step guides, clickable choices. ALWAYS also answer briefly in text — the block supplements, never replaces. Prefer ONE domain component per surface. Re-call with the SAME surface_id to revise a block in place. Components (props): " +
      "CampaignList{title?,items[](max 20):{campaignId,name,status?,audienceCount?,spend?,sendDate?,size?}}, CampaignCard{campaignId,name,status?,audienceCount?,spend?,sendDate?,size?}, " +
      "ReferralList{title?,items[](max 20):{referralId,referrer,jobType?,jobValue?,status?}}, ReferralCard{referralId,referrer,jobType?,jobValue?,status?}, " +
      "PostcardPreview{bundleId,name?,size?} — REFERENCE ONLY: pass the bundle id, never HTML; the client fetches and renders the design itself. " +
      "TemplateList{title?,items[](max 20):{bundleId,name,size?,updatedAt?,usedInCampaigns?}}, " +
      "ZoneMap{title?,zoneId?,center?{lat,lng},points[](max 500):{lat,lng,kind?(home|business),status?(valid|opt_out|skipped),address?},counts?{valid?,optOut?,skipped?}} — live map; PREFER passing just zoneId (the client fetches the zone's addresses itself) over inline points. " +
      "DataTable{title?,columns[](max 8),rows[][](max 50 rows; string|number cells)}, StatCards{items[](max 8):{label,value,hint?,trend?(up|down|flat)}}, " +
      "Checklist{title,subtitle?,items[]:{label,status(pass|warn|fail),note?,fixPrompt?}}, GuideSteps{title,subtitle?,steps[]:{title,detail?,prompt,state(done|active|todo)}}, " +
      "ChoiceChips{choices[]:{label,prompt}}, NavButton{label,href(/path)}, " +
      "Text{text,variant?(title|subtitle|body|caption)}, Row{children[ids],gap?}, Column{children[ids],gap?}, Card{title?,children[ids]}, " +
      "Button{label,action,tone?(primary|neutral|ghost)}, Divider{}, Image{url(https),alt?}. " +
      "Button.action = {type:'send',prompt,display?} | {type:'navigate',href:'/path'} | {type:'openUrl',url:'https://'}. " +
      "fixPrompt/GuideSteps.prompt/ChoiceChips.prompt/Button send prompt = the literal user message to receive when clicked. hrefs are in-app paths only (e.g. /campaigns/{id}, /templates/{id}, /targeting/zones, /analytics/overview). " +
      "Build every block from REAL tool data — never invent campaignIds, bundleIds, zoneIds, counts, or statuses. Where the data comes from: CampaignList/CampaignCard from list_campaigns, search_campaigns or get_campaign; StatCards from get_dashboard_analytics or get_summary_analytics; ZoneMap zoneId from get_targeting_summary or get_live_context; PostcardPreview/TemplateList from list_template_bundles or get_template_bundle; ReferralList from list_referrals or search_referrals; DataTable from any tabular read (analytics rows, billing history). " +
      "Don't over-render: a one-line factual answer stays prose. Reach for a block when there's a list, a comparison, something geographic, or a clear next step to click.",
    inputSchema: {
      surface_id: z.string().describe("Stable id. Re-emit the SAME id to replace/revise the block in place; a new id appends another block."),
      mode: z.enum(["replace"]).optional(),
      root: z.string().describe("id of the component to render as the root"),
      components: z.array(z.object({
        id: z.string(),
        component: z.record(z.any()).optional().describe('{"<TypeName>": { ...props }}'),
        componentType: z.string().optional(),
        properties: z.record(z.any()).optional(),
      })).describe("Flat array; children referenced by id"),
      data_model: z.record(z.any()).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async (a) => {
    const v = validateUiFrame(a);
    if (!v.ok) {
      return { isError: true, content: [{ type: "text", text: `emit_ui rejected: ${v.error}. Fix the payload and call emit_ui again.` }] };
    }
    // Designer surfaces are write paths in disguise: the proposal card's Approve button saves
    // to the design library (or the campaign) straight from the browser, bypassing the write
    // tools' role gates. Gate the surface itself: technicians never design; marketers may only
    // design FOR a campaign (library saves are template management, which their role excludes).
    const proposal = v.frame.components.find((c) => c.component?.TemplateProposal);
    if (proposal) {
      const area = proposal.component.TemplateProposal?.campaign_id ? "campaigns" : "template_management";
      const denial = await roleAreaDenial(userJwt, area);
      if (denial) return asText(denial);
    }
    const job = createJob(userId, "emit_ui");
    jobEmit(job, v.frame);
    jobComplete(job, { surface_id: v.frame.surface_id });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, surface_id: v.frame.surface_id, ui_job_id: job.id, rendered: a.components.length }) }] };
  });
}
