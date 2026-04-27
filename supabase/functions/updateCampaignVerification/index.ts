import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * updateCampaignVerification Edge Function
 * Updates the skip_address_verification flag for a campaign_csv_address_list.
 * 
 * Request Body:
 * {
 *   "csv_address_csv_address_list_id": "uuid",
 *   "skip_address_verification": boolean
 * }
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);

    if (!user) {
      return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);
    }

    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse("NO_ORGANIZATION", "User is not associated with any organization", 403);
    }

    const { csv_address_list_id, skip_address_verification } = await req.json();

    if (!csv_address_list_id || typeof skip_address_verification !== 'boolean') {
      return errorResponse("INVALID_INPUT", "csv_address_list_id and skip_address_verification (boolean) are required", 400);
    }

    // 1. Fetch the list to ensure it exists and belongs to the org
    const { data: list, error: fetchError } = await supabase
      .from("campaign_csv_address_lists")
      .select("id")
      .eq("id", csv_address_list_id)
      .eq("organization_id", organizationId)
      .single();

    if (fetchError || !list) {
      return errorResponse("NOT_FOUND", "Address list not found", 404);
    }

    // 2. Update DB
    const { error: updateError } = await supabase
      .from("campaign_csv_address_lists")
      .update({
        skip_address_verification: skip_address_verification,
        updated_at: new Date().toISOString()
      })
      .eq("id", csv_address_list_id);

    if (updateError) {
      console.error("Update error in updateCampaignVerification:", updateError);
      return errorResponse("DB_ERROR", "Failed to update address list verification status", 500);
    }

    return successResponse({
      message: `Successfully updated verification status`,
      skip_address_verification
    });

  } catch (error) {
    console.error("Unexpected error in updateCampaignVerification:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
