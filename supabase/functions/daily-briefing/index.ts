import { corsResponse, successResponse, errorResponse } from "../_shared/response.ts";
import { runMorning }      from "./morning.ts";
import { runMidday }       from "./midday.ts";
import { runDayend }       from "./dayend.ts";
import { runTimelineSync } from "./timeline_sync.ts";

const VALID_TYPES = ["morning", "midday", "dayend", "timeline_sync"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    const { type } = await req.json() as { type?: string };

    if (!type || !VALID_TYPES.includes(type)) {
      return errorResponse("invalid_type", `Body must contain { "type": "${VALID_TYPES.join(" | ")}" }`, 400);
    }

    console.log(`[daily-briefing] Running ${type}…`);

    if (type === "morning")       await runMorning();
    if (type === "midday")        await runMidday();
    if (type === "dayend")        await runDayend();
    if (type === "timeline_sync") {
      const result = await runTimelineSync();
      console.log(`[daily-briefing] timeline_sync complete.`);
      return successResponse({ ok: true, type, ...result });
    }

    console.log(`[daily-briefing] ${type} complete.`);
    return successResponse({ ok: true, type });
  } catch (err) {
    console.error("[daily-briefing] Error:", err);
    return errorResponse("internal_error", String(err), 500);
  }
});
