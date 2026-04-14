import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { AddressRow, ValidatedAddress } from "../_shared/addressLists.ts";

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
       .select("id, list_name, addresses, validated_address_list")
       .eq("campaign_id", campaign_id)
       .eq("organization_id", organizationId)
       .single();

    if (fetchError || !list) {
      return errorResponse("NOT_FOUND", "Address list not found", 404);
    }

    const addresses: AddressRow[] = list.addresses || [];
    const validatedAddresses: ValidatedAddress[] = list.validated_address_list || [];

    // Group addresses
    // We consider an address "included" if:
    // - It's from validatedAddressList (if populated)
    // - OR from addresses (if not yet geocoded)
    const included = validatedAddresses.length > 0 
      ? validatedAddresses 
      : addresses.filter(addr => (addr.is_included && !addr.is_deleted));

    // Excluded addresses should be the rows in 'addresses' that are NOT in the 'included' list.
    const includedRowIdSet = new Set(
      validatedAddresses.map(v => v.row_id).filter(Boolean)
    );
    
    const includedAddressSet = new Set(
      validatedAddresses.length > 0
        ? validatedAddresses.filter(v => !v.row_id).map(v => v.original_address?.toUpperCase() || v.address.toUpperCase())
        : addresses.filter(addr => addr.is_included && !addr.is_deleted).map(addr => (addr.address || `${addr.address_line1 || ""}, ${addr.city || ""}`).toUpperCase().trim())
    );

    const excluded = addresses.filter(addr => {
      // Always exclude if explicitly marked
      if (addr.is_deleted || addr.is_duplicate || addr.is_valid === false || addr.status === "invalid") return true;
      
      // If we have a row_id match, it's included
      if (addr.id && includedRowIdSet.has(addr.id)) return false;

      // If geocoding has happened, and it's not in the 'included' set, then it's effectively excluded
      // We only fallback to string matching if row_id is missing or doesn't match
      const addrStr = (addr.address || `${addr.address_line1 || ""}, ${addr.city || ""}`).toUpperCase().trim();
      return !includedAddressSet.has(addrStr);
    });

    return successResponse({
      id: list.id,
      list_name: list.list_name,
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
