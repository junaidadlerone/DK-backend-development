import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { AddressRow, AddressListMetadata as _AddressListMetadata, ValidatedAddress } from "../_shared/addressLists.ts";

/**
 * Validate Address Edge Function
 * Performs geocoding via Google Maps API for rows in a CSV address list.
 */

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
    const startTime = Date.now();
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);

    if (!user) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) return errorResponse("NO_ORGANIZATION", "User not in organization", 403);

    const body = await req.json();
    const { list_id } = body;

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
    const validatedAddressList: ValidatedAddress[] = list.validated_address_list || [];
    let updatedCount = 0;

    // Fetch user profile for createdBy
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name, user_role, created_at, updated_at")
      .eq("id", user.userId)
      .single();

    if (profileError || !profile) {
      console.error("Profile fetch error:", profileError);
    }

    // 2. Validate
    for (let i = 0; i < addresses.length; i++) {
        const row = addresses[i];

        const addressStr = `${row.address_line1 || ""}, ${row.city || ""}, ${row.state || ""} ${row.zip || ""}`.trim();
        if (addressStr === "," || addressStr === "") {
            console.warn(`Skipping row ${i} due to empty address fields`);
            continue;
        }
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

                const validatedItem = {
                    lat: geo.lat,
                    long: geo.long,
                    osm_id: null,
                    status: "Valid",
                    address: addressStr.toUpperCase(),
                    verified: true,
                    zoneType: "radius(0.3km)",
                    createdBy: profile ? {
                        id: profile.id,
                        full_name: profile.full_name,
                        user_role: profile.user_role,
                        created_at: profile.created_at,
                        updated_at: profile.updated_at
                    } : null,
                    residential: true,
                    propertyType: "Single Family Home",
                    building_type: null,
                    postcards_sent: 0,
                    original_address: addressStr.toUpperCase(),
                    campaigns_used_in: [],
                    distanceFromCenter: 0,
                    targeting_zone_name: `Zone at ${geo.lat.toFixed(4)}, ${geo.long.toFixed(4)}`,
                    verification_details: {
                        city: (row.city || "").toUpperCase(),
                        line1: (row.address_line1 || "").toUpperCase(),
                        status: "verified",
                        details: {},
                        postalOrZip: row.zip || "",
                        provinceOrState: (row.state || "").toUpperCase()
                    },
                    first_post_card_sent_date: null
                };

                validatedAddressList.push(validatedItem);
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
    }

    if (updatedCount === 0) {
        return errorResponse("VALIDATION_FAILED", "Geocoding could not locate any addresses", 422);
    }

    // 2.3 Calculate center and zone_name
    let center = null;
    let zone_name = null;
    if (updatedCount > 0) {
        let sumLat = 0;
        let sumLong = 0;
        validatedAddressList.forEach(item => {
            sumLat += item.lat;
            sumLong += item.long;
        });
        const avgLat = sumLat / updatedCount;
        const avgLong = sumLong / updatedCount;
        center = { lat: avgLat, long: avgLong, radius: 500 }; // Default 500m radius for CSV lists
        zone_name = `Zone at ${avgLat.toFixed(4)}, ${avgLong.toFixed(4)}`;
    }

    // 3. Save
    const { error: updateError } = await supabase
        .from("campaign_csv_address_lists")
        .update({
            addresses,
            validated_address_list: validatedAddressList,
            center,
            zone_name,
            metadata: {
                ...(list.metadata || {}),
                last_operation: "validateAddresses",
                last_validation_batch_size: updatedCount
            },
            operation_history: [...(list.operation_history || []), {
                operation: "validate_addresses",
                timestamp: new Date().toISOString(),
                status: "Completed",
                details: {
                    updated_count: updatedCount
                }
            }],
            updated_at: new Date().toISOString()
        })
        .eq("id", list_id);

    if (updateError) return errorResponse("DB_ERROR", "Failed to update address list", 500);

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
        status: "success",
        message: `Verified ${updatedCount} of ${addresses.length} addresses`,
        center,
        mode: "address-list",
        searchType: "RESIDENTIAL",
        metadata: {
            totalBuildingsFound: addresses.length,
            addressesReturned: addresses.length,
            residentialCount: addresses.length,
            otherCount: 0,
            verified_count: updatedCount,
            unverified_count: addresses.length - updatedCount,
            processingTimeMs
        },
        addresses: validatedAddressList
    });

  } catch (error) {
    console.error("error in validateAddresses:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
