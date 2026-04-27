import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { AddressRow } from "../_shared/addressLists.ts";

/**
 * deleteCSVAddresses Edge Function
 * Marks specific address IDs in a campaign_csv_address_list as deleted.
 * 
 * Request Body:
 * {
 *   "list_id": "uuid",
 *   "address_ids": ["uuid", "uuid", ...]
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

    const { list_id, address_ids } = await req.json();

    if (!list_id || !Array.isArray(address_ids) || address_ids.length === 0) {
      return errorResponse("INVALID_INPUT", "list_id and non-empty address_ids array are required", 400);
    }

    // 1. Fetch the list
    const { data: list, error: fetchError } = await supabase
      .from("campaign_csv_address_lists")
      .select("*")
      .eq("id", list_id)
      .eq("organization_id", organizationId)
      .single();

    if (fetchError || !list) {
      return errorResponse("NOT_FOUND", "Address list not found", 404);
    }

    const addresses: AddressRow[] = list.addresses || [];
    let updatedCount = 0;

    const updatedAddresses = addresses.map((addr: AddressRow) => {
      if (address_ids.includes(addr.id)) {
        if (!addr.is_deleted) {
          updatedCount++;
          return { ...addr, is_deleted: true, is_included: false };
        }
      }
      return addr;
    });

    if (updatedCount === 0) {
      return successResponse({
        message: "No new addresses marked as deleted",
        updated_count: 0
      });
    }

    // 2. Update metadata and history
    const validCount = updatedAddresses.filter((r: AddressRow) => r.status === "valid" && !r.is_deleted).length;
    const _invalidCount = updatedAddresses.filter((r: AddressRow) => r.status === "invalid" || r.is_deleted).length; // User said invalid, duplicate, and deleted are excluded

    const newMetadata = {
      ...(list.metadata || {}),
      valid_count: validCount,
      last_operation: "deleteCSVAddresses",
      deleted_count: (list.metadata?.deleted_count || 0) + updatedCount
    };

    const newHistoryEntry = {
      operation: "delete_addresses",
      timestamp: new Date().toISOString(),
      status: "Completed",
      details: {
        deleted_count: updatedCount,
        address_ids
      }
    };

    const updatedHistory = [...(list.operation_history || []), newHistoryEntry];

    // 3. Update DB
    const { error: updateError } = await supabase
      .from("campaign_csv_address_lists")
      .update({
        addresses: updatedAddresses,
        metadata: newMetadata,
        operation_history: updatedHistory,
        updated_at: new Date().toISOString()
      })
      .eq("id", list_id);

    if (updateError) {
      console.error("Update error in deleteCSVAddresses:", updateError);
      return errorResponse("DB_ERROR", "Failed to update address list", 500);
    }

    return successResponse({
      message: `Successfully marked ${updatedCount} addresses as deleted`,
      updated_count: updatedCount
    });

  } catch (error) {
    console.error("Unexpected error in deleteCSVAddresses:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
