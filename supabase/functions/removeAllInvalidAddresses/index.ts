import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { AddressRow } from "../_shared/addressLists.ts";

/**
 * deleteInvalidAddresses Edge Function
 * Marks ALL addresses with is_valid: false as deleted in a campaign_csv_address_list.
 * 
 * Request Body:
 * {
 *   "list_id": "uuid"
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

    const body = await req.json();
    const { list_id } = body;

    if (!list_id) {
      return errorResponse("INVALID_INPUT", "list_id is required", 400);
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
      // Check if address is invalid based on missing required fields
      const missingRequiredFields = !addr.address_line1 || !addr.city || !addr.state || !addr.zip;
      
      // Mark as deleted if explicitly marked as invalid, missing fields, and not already deleted
      if ((addr.is_valid === false || missingRequiredFields) && !addr.is_deleted) {
        updatedCount++;
        return { ...addr, is_deleted: true, is_included: false, status: "invalid" };
      }
      return addr;
    });

    if (updatedCount === 0) {
      return successResponse({
        message: "No new invalid addresses to mark as deleted",
        updated_count: 0
      });
    }

    // 2. Update metadata and history
    const validCount = updatedAddresses.filter((r: AddressRow) => r.is_valid === true && !r.is_deleted).length;
    const invalidCount = updatedAddresses.filter((r: AddressRow) => r.is_valid === false && !r.is_deleted).length;
    const deletedCount = updatedAddresses.filter((r: AddressRow) => r.is_deleted === true).length;

    const newMetadata = {
      ...(list.metadata || {}),
      valid_count: validCount,
      invalid_count: invalidCount,
      deleted_count: deletedCount,
      last_operation: "deleteInvalidAddresses"
    };

    const newHistoryEntry = {
      operation: "delete_invalid_addresses",
      timestamp: new Date().toISOString(),
      status: "Completed",
      details: {
        deleted_count: updatedCount
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
      console.error("Update error in deleteInvalidAddresses:", updateError);
      return errorResponse("DB_ERROR", "Failed to update address list", 500);
    }

    return successResponse({
      message: `Successfully marked ${updatedCount} invalid addresses as deleted`,
      updated_count: updatedCount,
      metadata: newMetadata
    });

  } catch (error) {
    console.error("Unexpected error in deleteInvalidAddresses:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
