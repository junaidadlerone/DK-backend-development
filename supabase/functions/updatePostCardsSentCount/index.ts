import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";

/**
 * Update Postcards Sent Count Edge Function
 * Updates the postcards_sent count for a specific campaign
 *
 * Business Rules:
 * - Public access (no JWT auth required)
 * - Updates only the postcards_sent count
 * - Does NOT change campaign or referral status (use /changeCampaignStatus for that)
 *
 * Request body:
 * {
 *   "campaign_id": "uuid",
 *   "count": 123
 * }
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    // Create Supabase client (service role not needed as public access logic is handled here, 
    // but we use standard client. If RLS blocks public access, we might need service role, 
    // but assuming standard client works for public endpoints or anon access is sufficient for this logic if RLS allows.
    // However, usually for backend updates we might need more privileges if RLS is strict.
    // Let's stick to standard client first. If this is a public webhook listener, it usually needs SERVICE ROLE key 
    // to bypass RLS if the table is protected. But the shared client usually uses the auth header from request.
    // Since there is NO auth header here (public access), the standard client will be ANON.
    // If campaigns table is not writable by ANON, this will fail.
    // Given the context of "public API", it often implies a system-level integration.
    // I will use the standard client but be aware of RLS. If RLS fails, we might need a service role client.
    // For now, following patterns of getCampaignLaunchData (which is public).
    
    const supabase = createSupabaseClient();

    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON format in request body",
        400
      );
    }

    const { campaign_id, count } = body;

    // Validate inputs
    if (!campaign_id) {
      return errorResponse(
        "INVALID_INPUT",
        "campaign_id is required",
        400
      );
    }

    if (typeof count !== "number" || count < 0) {
      return errorResponse(
        "INVALID_INPUT",
        "count must be a non-negative number",
        400
      );
    }

    // Verify campaign exists
    const { data: campaign, error: fetchError } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaign_id)
      .single();

    if (fetchError || !campaign) {
      return errorResponse(
        "CAMPAIGN_NOT_FOUND",
        "Campaign not found",
        404
      );
    }

    // Update only the postcards_sent count
    const { error: updateError } = await supabase
      .from("campaigns")
      .update({
        postcards_sent: count,
        updated_at: new Date().toISOString()
      })
      .eq("id", campaign_id);

    if (updateError) {
      console.error("Error updating postcard count:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to update postcard count",
        500
      );
    }

    return successResponse({
      status: "success",
      message: "Postcard count updated successfully",
      campaign_id,
      count
    });

  } catch (error) {
    console.error("Unexpected error in updatePostCardsSentCount:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
});
