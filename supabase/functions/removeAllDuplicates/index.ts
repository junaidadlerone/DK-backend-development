import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { AddressRow, AddressListMetadata } from "../_shared/addressLists.ts";

/**
 * Remove All Duplicates Edge Function
 * Prunes rows marked as 'is_duplicate' from a CSV address list.
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

    const originalAddresses: AddressRow[] = list.addresses || [];
    const filteredAddresses = originalAddresses.filter((addr: AddressRow) => !addr.is_duplicate);
    
    const removedCount = originalAddresses.length - filteredAddresses.length;

    if (removedCount === 0) {
        return successResponse({
            message: "No duplicates found to remove",
            removed_count: 0
        });
    }

    // 2. Recalculate metadata
    const validCount = filteredAddresses.filter((r: AddressRow) => r.status === "valid").length;
    const invalidCount = filteredAddresses.filter((r: AddressRow) => r.status === "invalid").length;

    const newMetadata: AddressListMetadata = {
        ...(list.metadata || {}),
        total_rows: filteredAddresses.length,
        valid_count: validCount,
        invalid_count: invalidCount,
        duplicate_count: 0,
        last_operation: "removeAllDuplicates",
        removed_count: (list.metadata?.removed_count || 0) + removedCount
    };

    const newHistoryEntry = {
        operation: "remove_duplicates",
        timestamp: new Date().toISOString(),
        status: "Completed",
        details: {
            removed_count: removedCount,
            total_after: filteredAddresses.length
        }
    };

    const updatedHistory = [...(list.operation_history || []), newHistoryEntry];

    // 3. Update DB
    const { error: updateError } = await supabase
        .from("campaign_csv_address_lists")
        .update({
            addresses: filteredAddresses,
            metadata: newMetadata,
            operation_history: updatedHistory,
            updated_at: new Date().toISOString()
        })
        .eq("id", list_id);

    if (updateError) {
        console.error("Update error in removeAllDuplicates:", updateError);
        return errorResponse("DB_ERROR", "Failed to update address list", 500);
    }

    return successResponse({
        message: "Successfully removed all duplicates",
        removed_count: removedCount,
        remaining_count: filteredAddresses.length
    });

  } catch (error) {
    console.error("Unexpected error in removeAllDuplicates:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
