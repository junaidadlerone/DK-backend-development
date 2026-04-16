import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Sync Postcard Statuses Edge Function (Scheduled / CRON)
 * Fetches the current delivery status of every non-terminal postcard
 * from the PostGrid API and updates postcard_sends in the database.
 *
 * Terminal statuses (completed, cancelled) are never re-checked.
 * Non-terminal statuses (ready, printing, processed_for_delivery) are
 * queried from PostGrid on every run.
 *
 * Process:
 * 1. Fetch all postcard_sends rows where status is non-terminal
 * 2. Query PostGrid GET /print-mail/v1/postcards/{id} for each row
 * 3. Update postgrid_status + status_updated_at in the database
 * 4. Process in batches of 50 to respect rate limits
 *
 * Intended to run on a schedule (e.g., every 6 hours via Supabase cron
 * or an external scheduler). Can also be triggered manually.
 */

const POSTGRID_BASE_URL = "https://api.postgrid.com/print-mail/v1";
const TERMINAL_STATUSES = ["completed", "cancelled"];
const BATCH_SIZE = 50;

interface PostcardSendRow {
  id: string;
  postgrid_postcard_id: string;
  postgrid_status: string;
}

interface PostGridPostcardResponse {
  id: string;
  status: string;
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
    .select("id, postgrid_postcard_id, postgrid_status")
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
          const newStatus = pgData.status;

          // Only write if the status actually changed
          if (newStatus && newStatus !== row.postgrid_status) {
            const { error: updateError } = await supabase
              .from("postcard_sends")
              .update({
                postgrid_status: newStatus,
                status_updated_at: now,
              })
              .eq("id", row.id);

            if (updateError) {
              console.error(
                `[syncPostcardStatuses] DB update failed for ${row.id}:`,
                updateError,
              );
              errorCount++;
            } else {
              updatedCount++;
              console.log(
                `[syncPostcardStatuses] ${row.postgrid_postcard_id}: ${row.postgrid_status} → ${newStatus}`,
              );
            }
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
