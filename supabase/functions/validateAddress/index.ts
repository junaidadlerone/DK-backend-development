import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { AddressRow, AddressListMetadata as _AddressListMetadata } from "../_shared/addressLists.ts";

/**
 * Validate Address Edge Function
 * Performs geocoding via Google Maps API for rows in a CSV address list.
 */

const GOOGLE_MAPS_API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");

async function geocode(addressStr: string) {
  if (!GOOGLE_MAPS_API_KEY) throw new Error("GOOGLE_MAPS_API_KEY is not set");
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
    const { list_id, address_id } = body;

    if (!list_id) return errorResponse("INVALID_INPUT", "list_id is required", 400);

    // 1. Fetch the list
    const { data: list, error: fetchError } = await supabase
        .from("campaign_csv_address_lists")
        .select("*")
        .eq("id", list_id)
        .eq("organization_id", organizationId)
        .single();

    if (fetchError || !list) return errorResponse("NOT_FOUND", "Address list not found", 404);

    const addresses: AddressRow[] = list.addresses || [];
    let updatedCount = 0;

    // 2. Validate
    for (let i = 0; i < addresses.length; i++) {
        const row = addresses[i];
        // If address_id is provided, only validate that one. Otherwise validate all included.
        if (address_id && row.id !== address_id) continue;
        if (!address_id && (!row.is_included || row.lat)) continue;

        const addressStr = `${row.address_line1}, ${row.city}, ${row.state} ${row.zip}`;
        try {
            const geo = await geocode(addressStr);
            if (geo.success) {
                addresses[i] = {
                    ...row,
                    lat: geo.lat,
                    long: geo.long,
                    is_valid: true,
                    status: "valid"
                };
                updatedCount++;
            } else {
                addresses[i] = {
                    ...row,
                    is_valid: false,
                    status: "invalid",
                    error_message: `Geocoding failed: ${geo.status}`
                };
            }
        } catch (e) {
            console.error(`Geocoding error for ${addressStr}:`, e);
        }

        // Limit batch processing to avoid timeouts if validate_all
        if (!address_id && updatedCount >= 50) break; 
    }

    if (updatedCount === 0 && address_id) {
        return errorResponse("VALIDATION_FAILED", "Geocoding could not locate the address", 422);
    }

    // 3. Save
    const { error: updateError } = await supabase
        .from("campaign_csv_address_lists")
        .update({
            addresses,
            metadata: {
                ...(list.metadata || {}),
                last_operation: "validateAddress",
                last_validation_batch_size: updatedCount
            },
            operation_history: [...(list.operation_history || []), {
                operation: "validate_address",
                timestamp: new Date().toISOString(),
                status: "Completed",
                details: {
                    target_id: address_id || "all",
                    updated_count: updatedCount
                }
            }],
            updated_at: new Date().toISOString()
        })
        .eq("id", list_id);

    if (updateError) return errorResponse("DB_ERROR", "Failed to update address list", 500);

    return successResponse({
        message: `Successfully validated ${updatedCount} addresses`,
        updated_count: updatedCount
    });

  } catch (error) {
    console.error("error in validateAddress:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
