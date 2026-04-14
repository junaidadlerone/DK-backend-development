import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { AddressRow } from "../_shared/addressLists.ts";

/**
 * getCSVAddressListDetails Edge Function
 * Returns grouped addresses and counts for a specific address list.
 * 
 * Request Body:
 * {
 *   "campaign_id": "uuid"
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

    const { campaign_id } = await req.json();
 
    if (!campaign_id) {
      return errorResponse("INVALID_INPUT", "campaign_id is required", 400);
    }

    // 1. Fetch the list
     const { data: list, error: fetchError } = await supabase
        .from("campaign_csv_address_lists")
        .select("id, list_name, addresses, is_editing")
        .eq("campaign_id", campaign_id)
        .eq("organization_id", organizationId)
        .single();

    if (fetchError || !list) {
      return errorResponse("NOT_FOUND", "Address list not found", 404);
    }

    const addresses: AddressRow[] = list.addresses || [];

    // Group addresses directly from the addresses array
    // An address is 'included' if it is marked as included/valid and not deleted
    const included = addresses.filter(addr => 
      (addr.is_included || addr.status === "valid" || addr.status === "Valid" || addr.verified === true) && 
      !addr.is_deleted
    );

    // An address is 'excluded' if it's in the list but not in the included set
    // (This includes duplicates, deleted rows, or rows that failed geocoding)
    const excluded = addresses.filter(addr => !included.includes(addr));

    return successResponse({
      id: list.id,
      list_name: list.list_name,
      is_editing: list.is_editing || false,
      total_count: addresses.length,
      included_count: included.length,
      excluded_count: excluded.length,
      included,
      excluded
    });

  } catch (error) {
    console.error("Unexpected error in getCSVAddressListDetails:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
