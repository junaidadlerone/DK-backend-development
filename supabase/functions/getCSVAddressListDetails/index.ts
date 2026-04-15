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

    // 1. Fetch the list - Added skip_address_verification to select
     const { data: list, error: fetchError } = await supabase
        .from("campaign_csv_address_lists")
        .select("id, list_name, addresses, is_editing, skip_address_verification")
        .eq("campaign_id", campaign_id)
        .eq("organization_id", organizationId)
        .single();

    if (fetchError || !list) {
      return errorResponse("NOT_FOUND", "Address list not found", 404);
    }

    const addresses: AddressRow[] = list.addresses || [];

    // 2. Identify 'Included' (Valid) addresses
    const included = addresses.filter(addr => 
      (addr.is_included || addr.status === "valid" || addr.status === "Valid" || addr.verified === true) && 
      !addr.is_deleted
    );

    const excluded = addresses.filter(addr => !included.includes(addr));

    // 3. Logic for verification flags
    // Count addresses where is_reachable is explicitly true or false (not null)
    const verified_address_count = included.filter(addr => addr.is_reachable !== null).length;

    /** * verification_performed logic:
     * true if there's at least one valid address and NOT all are null 
     * (meaning at least one address has been processed)
     */
    const verification_performed = included.length > 0 && included.some(addr => addr.is_reachable !== null);

    return successResponse({
      id: list.id,
      list_name: list.list_name,
      is_editing: list.is_editing || false,
      skip_address_verification: list.skip_address_verification || false,
      verification_performed: verification_performed,
      total_count: addresses.length,
      included_count: included.length,
      excluded_count: excluded.length,
      verified_address_count: verified_address_count, // Will be 0 if all is_reachable are null
      included,
      excluded
    });

  } catch (error) {
    console.error("Unexpected error in getCSVAddressListDetails:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});