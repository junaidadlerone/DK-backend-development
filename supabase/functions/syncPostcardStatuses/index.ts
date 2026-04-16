import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Sync Postcard Statuses Edge Function (Scheduled / CRON)
 *
 * Fetches current delivery statuses from PostGrid for every non-terminal postcard
 * and updates postcard_sends in the database.
 *
 * PostGrid provides TWO separate tracking fields:
 *
 *   status (standard lifecycle — all orders):
 *     ready → printing → processed_for_delivery → completed
 *                                               → cancelled
 *
 *   imbStatus (Intelligent-Mail Tracking — US only, nullable):
 *     entered_mail_stream → out_for_delivery → (status becomes completed)
 *                                           → returned_to_sender
 *
 * Terminal statuses for postgrid_status: completed, cancelled
 *   (returned_to_sender lives in imbStatus, not status)
 *
 * Process:
 * 1. Fetch all postcard_sends where postgrid_status is non-terminal
 * 2. Call PostGrid GET /print-mail/v1/postcards/{id} for each
 * 3. Update postgrid_status from response.status
 * 4. Update imb_status from response.imbStatus (if present)
 * 5. Process in batches of 50 to respect rate limits
 */

const POSTGRID_BASE_URL = "https://api.postgrid.com/print-mail/v1";

// Only the main `status` field has true terminal values.
// imbStatus = returned_to_sender is tracked via the imb_status column separately.
const TERMINAL_STATUSES = ["completed", "cancelled"];

const BATCH_SIZE = 50;

interface PostcardSendRow {
  id: string;
  postgrid_postcard_id: string;
  postgrid_status: string;
  imb_status: string | null;
}

interface PostGridPostcardResponse {
  id: string;
  status: string;
  imbStatus?: string; // US Intelligent-Mail Tracking — present once at a USPS facility
}

Deno.serve(async (_req) => {
  console.log("[syncPostcardStatuses] Starting postcard status sync...");

  const supabase = createSupabaseClient();

  const postgridApiKey =
    Deno.env.get("POSTGRID_POSTCARD_API_KEY") ??
    Deno.env.get("VITE_POSTGRID_POSTCARD_API_KEY");

  if (!postgridApiKey) {
    console.error("[syncPostcardStatuses] POSTGRID_POSTCARD_API_KEY not set");
    return new Response(
      JSON.stringify({ success: false, error: "Missing POSTGRID_POSTCARD_API_KEY" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // 1. Fetch all non-terminal postcard records
  const { data: rows, error: fetchError } = await supabase
    .from("postcard_sends")
    .select("id, postgrid_postcard_id, postgrid_status, imb_status")
    .not("postgrid_status", "in", `(${TERMINAL_STATUSES.join(",")})`)
    .order("created_at", { ascending: true });

  if (fetchError) {
    console.error("[syncPostcardStatuses] Error fetching postcard_sends:", fetchError);
    return new Response(
      JSON.stringify({ success: false, error: fetchError.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const pending = (rows ?? []) as PostcardSendRow[];

  if (pending.length === 0) {
    console.log("[syncPostcardStatuses] No non-terminal postcards to sync.");
    return new Response(
      JSON.stringify({ success: true, message: "No postcards to sync", synced: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  console.log(`[syncPostcardStatuses] Found ${pending.length} non-terminal postcards to check.`);

  let updatedCount = 0;
  let errorCount = 0;
  const now = new Date().toISOString();

  // 2. Process in batches
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (row) => {
        try {
          const response = await fetch(
            `${POSTGRID_BASE_URL}/postcards/${row.postgrid_postcard_id}`,
            {
              method: "GET",
              headers: { "x-api-key": postgridApiKey },
            },
          );

          if (!response.ok) {
            const errText = await response.text();
            console.warn(
              `[syncPostcardStatuses] PostGrid ${response.status} for ${row.postgrid_postcard_id}: ${errText}`,
            );
            errorCount++;
            return;
          }

          const pgData: PostGridPostcardResponse = await response.json();

          const newStatus = pgData.status ?? row.postgrid_status;
          // imbStatus is only present on US orders once they hit a USPS facility
          const newImbStatus = pgData.imbStatus ?? null;

          const statusChanged = newStatus !== row.postgrid_status;
          const imbStatusChanged = newImbStatus !== row.imb_status;

          if (!statusChanged && !imbStatusChanged) {
            return; // Nothing changed — skip the DB write
          }

          const updatePayload: Record<string, string | null> = {
            status_updated_at: now,
          };

          if (statusChanged) updatePayload.postgrid_status = newStatus;
          if (imbStatusChanged) updatePayload.imb_status = newImbStatus;

          const { error: updateError } = await supabase
            .from("postcard_sends")
            .update(updatePayload)
            .eq("id", row.id);

          if (updateError) {
            console.error(
              `[syncPostcardStatuses] DB update failed for ${row.id}:`,
              updateError,
            );
            errorCount++;
          } else {
            updatedCount++;
            const statusLog = statusChanged
              ? `status: ${row.postgrid_status} → ${newStatus}`
              : "";
            const imbLog = imbStatusChanged
              ? `imbStatus: ${row.imb_status ?? "null"} → ${newImbStatus ?? "null"}`
              : "";
            console.log(
              `[syncPostcardStatuses] ${row.postgrid_postcard_id}: ${[statusLog, imbLog].filter(Boolean).join(", ")}`,
            );
          }
        } catch (err) {
          console.error(
            `[syncPostcardStatuses] Unexpected error for ${row.postgrid_postcard_id}:`,
            err,
          );
          errorCount++;
        }
      }),
    );
  }

  const summary = {
    success: true,
    message: "Postcard status sync complete",
    total_checked: pending.length,
    updated: updatedCount,
    errors: errorCount,
    unchanged: pending.length - updatedCount - errorCount,
  };

  console.log("[syncPostcardStatuses] Sync complete:", summary);

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
