import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Store Postcard Sends Edge Function
 * Internal-only: called by the WebSocket postcard sending server after each campaign run.
 * Batch-inserts individual PostGrid postcard records into postcard_sends table
 * so their delivery statuses can be tracked and queried for analytics.
 *
 * Business Rules:
 * - Internal use only — authenticated via Supabase service role key
 * - Idempotent: uses ON CONFLICT DO NOTHING on postgrid_postcard_id
 * - Derives organization_id from campaign_id
 *
 * Request body:
 * {
 *   "campaign_id": "uuid",
 *   "postcards": [
 *     { "postgrid_postcard_id": "postcard_xxx", "address": "123 Main St, City, ST 12345" },
 *     ...
 *   ]
 * }
 */

interface PostcardRecord {
  postgrid_postcard_id: string;
  address?: string;
}

interface RequestBody {
  campaign_id: string;
  postcards: PostcardRecord[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();

    // Parse request body
    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON format in request body", 400);
    }

    const { campaign_id, postcards } = body;

    if (!campaign_id || typeof campaign_id !== "string") {
      return errorResponse("INVALID_INPUT", "campaign_id is required and must be a string", 400);
    }

    if (!Array.isArray(postcards) || postcards.length === 0) {
      return errorResponse("INVALID_INPUT", "postcards must be a non-empty array", 400);
    }

    // Validate each record has a postgrid_postcard_id
    for (const p of postcards) {
      if (!p.postgrid_postcard_id || typeof p.postgrid_postcard_id !== "string") {
        return errorResponse("INVALID_INPUT", "Each postcard must have a valid postgrid_postcard_id", 400);
      }
    }

    // Look up organization_id from the campaign
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, organization_id")
      .eq("id", campaign_id)
      .single();

    if (campaignError || !campaign) {
      return errorResponse("CAMPAIGN_NOT_FOUND", "Campaign not found", 404);
    }

    const organizationId = campaign.organization_id;

    // Build rows to insert
    const rows = postcards.map((p) => ({
      campaign_id,
      organization_id: organizationId,
      postgrid_postcard_id: p.postgrid_postcard_id,
      postgrid_status: "ready",
      address: p.address ?? null,
    }));

    // Batch insert — ON CONFLICT DO NOTHING makes this idempotent
    const { error: insertError, count } = await supabase
      .from("postcard_sends")
      .upsert(rows, { onConflict: "postgrid_postcard_id", ignoreDuplicates: true })
      .select("id");

    if (insertError) {
      console.error("Error inserting postcard_sends:", insertError);
      return errorResponse("DATABASE_ERROR", "Failed to store postcard records", 500);
    }

    console.log(`[storePostcardSends] Stored ${rows.length} postcard records for campaign ${campaign_id}`);

    return successResponse({
      status: "success",
      message: `Stored ${rows.length} postcard records`,
      inserted: rows.length,
    }, 201);
  } catch (error) {
    console.error("Unexpected error in storePostcardSends:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error instanceof Error ? error.message : "Unknown error"}`,
      500,
    );
  }
});
