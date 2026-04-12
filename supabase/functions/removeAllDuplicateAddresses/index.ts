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
    let updatedCount = 0;

    const updatedAddresses = originalAddresses.map((addr: AddressRow) => {
      if (addr.is_duplicate && addr.is_included && !addr.is_deleted) {
        updatedCount++;
        return { ...addr, is_deleted: true, is_included: false };
      }
      return addr;
    });

    if (updatedCount === 0) {
        return successResponse({
            message: "No active duplicates found to exclude",
            updated_count: 0
        });
    }

    // 2. Recalculate metadata (total_rows stays the same)
    const validCount = updatedAddresses.filter((r: AddressRow) => r.status === "valid" && !r.is_deleted).length;
    const invalidCount = updatedAddresses.filter((r: AddressRow) => r.status === "invalid" || r.is_deleted).length;

    const newMetadata: AddressListMetadata = {
        ...(list.metadata || {}),
        valid_count: validCount,
        invalid_count: invalidCount,
        last_operation: "excludeAllDuplicates",
        excluded_duplicates_count: (list.metadata?.excluded_duplicates_count || 0) + updatedCount
    };

    const newHistoryEntry = {
        operation: "exclude_duplicates",
        timestamp: new Date().toISOString(),
        status: "Completed",
        details: {
            excluded_count: updatedCount,
            total_rows: updatedAddresses.length
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
        console.error("Update error in removeAllDuplicates:", updateError);
        return errorResponse("DB_ERROR", "Failed to update address list", 500);
    }

    return successResponse({
        message: "Successfully excluded all duplicates",
        excluded_count: updatedCount,
        total_count: updatedAddresses.length
    });

  } catch (error) {
    console.error("Unexpected error in removeAllDuplicates:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
