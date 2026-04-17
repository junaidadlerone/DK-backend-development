import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { AddressRow, AddressListMetadata as _AddressListMetadata } from "../_shared/addressLists.ts";

/**
 * Edit Address Edge Function
 * Updates a specific row within a CSV address list.
 */

function validateAddressFields(row: Partial<AddressRow>): { isValid: boolean; missingFields: string[] } {
    const missingFields: string[] = [];
    if (!row.address_line1) missingFields.push("Address Line 1");
    if (!row.city) missingFields.push("City");
    if (!row.state) missingFields.push("State");
    if (!row.zip) missingFields.push("Zip Code");
    
    return {
        isValid: missingFields.length === 0,
        missingFields
    };
}

const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");

async function geocode(addressStr: string) {
  if (!GOOGLE_MAPS_API_KEY) {
    console.error("GOOGLE_MAPS_API_KEY is not set");
    return { lat: 0, long: 0, success: false, status: "MISSING_API_KEY" };
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressStr)}&key=${GOOGLE_MAPS_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === "OK" && data.results.length > 0) {
    const loc = data.results[0].geometry.location;
    return { lat: loc.lat, long: loc.lng, success: true };
  }
  return { lat: 0, long: 0, success: false, status: data.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);

    if (!user) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) return errorResponse("NO_ORGANIZATION", "User not in organization", 403);

    const body = await req.json();
    const { list_id, address_id, updates } = body;

    if (!list_id || !address_id || !updates) {
        return errorResponse("INVALID_INPUT", "list_id, address_id, and updates are required", 400);
    }

    // 1. Fetch the list
    const { data: list, error: fetchError } = await supabase
        .from("campaign_csv_address_lists")
        .select("*")
        .eq("id", list_id)
        .eq("organization_id", organizationId)
        .single();

    if (fetchError || !list) return errorResponse("NOT_FOUND", "Address list not found", 404);

    const addresses: AddressRow[] = list.addresses || [];
    const index = addresses.findIndex(a => a.id === address_id);

    if (index === -1) return errorResponse("NOT_FOUND", "Address row not found", 404);

    // 2. Apply updates
    const target = addresses[index];
    const updatedRow = { ...target, ...updates };

    // 3. Re-validate
    const { isValid, missingFields } = validateAddressFields(updatedRow);
    updatedRow.is_valid = isValid;

    if (isValid) {
        updatedRow.status = "valid";
        delete updatedRow.error_message;

        // Perform Geocoding
        const addressStr = `${updatedRow.address_line1}, ${updatedRow.city}, ${updatedRow.state} ${updatedRow.zip}`;
        console.log(`Geocoding updated address: ${addressStr}`);
        
        const geo = await geocode(addressStr);
        if (geo.success) {
            updatedRow.lat = geo.lat;
            updatedRow.long = geo.long;
            updatedRow.verified = true;
            updatedRow.verification_details = {
                city: updatedRow.city,
                line1: updatedRow.address_line1,
                status: "verified",
                postalOrZip: updatedRow.zip,
                provinceOrState: updatedRow.state
            };
        } else {
            console.warn(`Geocoding failed for updated address: ${geo.status}`);
            // We don't mark as invalid just because geocoding failed, 
            // but we lack coordinates.
        }
    } else {
        updatedRow.status = "invalid";
        updatedRow.error_message = `Missing required fields: ${missingFields.join(", ")}`;
    }

    addresses[index] = updatedRow;

    // 4. Update metadata
    const validCount = addresses.filter(r => r.status === "valid").length;
    const invalidCount = addresses.filter(r => r.status === "invalid").length;
    const duplicateCount = addresses.filter(r => r.status === "duplicate").length;
    
    const newMetadata = {
        ...(list.metadata || {}),
        valid_count: validCount,
        invalid_count: invalidCount,
        duplicate_count: duplicateCount,
        last_operation: "editAddress"
    };

    const newHistoryEntry = {
        operation: "edit_address",
        timestamp: new Date().toISOString(),
        status: "Completed",
        details: {
            address_id: address_id,
            updated_fields: Object.keys(updates),
            is_valid: updatedRow.is_valid
        }
    };

    const updatedHistory = [...(list.operation_history || []), newHistoryEntry];

    // 5. Save
    const { error: updateError } = await supabase
        .from("campaign_csv_address_lists")
        .update({
            addresses,
            metadata: newMetadata,
            operation_history: updatedHistory,
            updated_at: new Date().toISOString()
        })
        .eq("id", list_id);

    if (updateError) return errorResponse("DB_ERROR", "Failed to update address list", 500);

    return successResponse({
        message: "Address updated successfully",
        updated_address: updatedRow
    });

  } catch (error) {
    console.error("error in editAddress:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
