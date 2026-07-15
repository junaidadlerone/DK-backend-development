// Generative UI — the emit_ui tool.
// The frontend parses a {type:"ui"} SSE frame off the chat stream and renders only
// design-system components validated against genui-catalog.schema.json (GENERATED from the
// frontend's zod catalog — copy from DoorKnockerPlus_Frontend `npm run genui:catalog`, never
// hand-edit). This tool lets the agent render those blocks: it validates the frame server-side
// (ajv), then emits it into a job — the gateway forwards the buffered frame onto the chat SSE.
// The tool's RETURN value is a tiny ack so the (large) UI payload never re-enters the model's
// context.
import { z } from "zod";
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

  // Per-component prop validation against the catalog schema.
  for (const n of normalized) {
    const ok = validators[n.type](n.props);
    if (!ok) {
      const e = validators[n.type].errors?.[0];
      const where = e ? `${e.instancePath || "(root)"} ${e.message}` : "invalid props";
      return { ok: false, error: `${n.type} "${n.id}": ${where}` };
    }
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

export function registerGenUiTools(server, { userId }) {
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
    const job = createJob(userId, "emit_ui");
    jobEmit(job, v.frame);
    jobComplete(job, { surface_id: v.frame.surface_id });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, surface_id: v.frame.surface_id, ui_job_id: job.id, rendered: a.components.length }) }] };
  });
}
