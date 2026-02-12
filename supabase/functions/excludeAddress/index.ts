import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { CreatedByInfo } from "../_shared/types.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * Exclude Address Edge Function
 * Opts out an address across all zones accessible to the user
 *
 * Business Rules:
 * - Takes a complete address object in request body
 * - Finds the address across all zones in user's organization
 * - Changes status to 'Opt-out' wherever found
 * - Matches based on lat/lng coordinates (with tolerance)
 * - Returns list of zones where address was updated
 *
 * Request body:
 * {
 *   "address": {
 *     "lat": number,
 *     "long": number,
 *     "address": string,
 *     ... (full address object)
 *   }
 * }
 */

interface AddressObject {
  lat: number;
  long: number;
  address: string;
  residential?: boolean;
  building_type?: string;
  osm_id?: string;
  propertyType?: string;
  distanceFromCenter?: number;
  targeting_zone_name?: string;
  campaigns_used_in?: string[];
  zoneType?: string;
  postcards_sent?: number;
  first_post_card_sent_date?: string | null;
  status?: string;
  zone_id?: string;
  zone_name?: string;
  campaign_id?: string;
}

interface RequestBody {
  address: AddressObject;
}

// Helper function to check if two coordinates match within tolerance
function coordinatesMatch(lat1: number, lng1: number, lat2: number, lng2: number, tolerance = 0.000001): boolean {
  return Math.abs(lat1 - lat2) < tolerance && Math.abs(lng1 - lng2) < tolerance;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  const startTime = Date.now();

  try {
    // Create Supabase client
    const supabase = createSupabaseClient();

    // Get user from request
    const user = getUserFromRequest(req);
    if (!user) {
      return errorResponse(
        "UNAUTHORIZED",
        "Unable to authenticate user",
        401
      );
    }

    // Get user profile for createdBy field
    const { getUserProfile } = await import("../_shared/history.ts");
    const userProfile = await getUserProfile(supabase, user.userId);
    if (!userProfile) {
      return errorResponse(
        "USER_PROFILE_NOT_FOUND",
        "User profile not found",
        404
      );
    }

    // Get user's organization
    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403
      );
    }

    // Parse request body
    let requestBody: RequestBody;
    try {
      requestBody = await req.json();
    } catch (parseError) {
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON in request body",
        400
      );
    }

    // Validate request body
    if (!requestBody.address) {
      return errorResponse(
        "INVALID_INPUT",
        "Missing 'address' object in request body",
        400
      );
    }

    const addressToExclude = requestBody.address;

    // Validate required fields
    if (typeof addressToExclude.lat !== "number" || typeof addressToExclude.long !== "number") {
      return errorResponse(
        "INVALID_INPUT",
        "Address must have valid 'lat' and 'long' coordinates",
        400
      );
    }

    // Fetch all zones for the organization
    const { data: zones, error: zonesError } = await supabase
      .from("location_zones")
      .select(`
        id,
        campaign_id,
        zone_name,
        addresses
      `)
      .eq("organization_id", organizationId);

    if (zonesError) {
      console.error("Error fetching zones:", zonesError);
      return errorResponse(
        "ZONES_FETCH_FAILED",
        "Failed to fetch zones",
        500
      );
    }

    if (!zones || zones.length === 0) {
      return successResponse(
        {
          status: "success",
          message: "No zones found for organization",
          zonesUpdated: [],
          addressesUpdated: 0,
          processingTimeMs: Date.now() - startTime
        },
        200
      );
    }

    // Track zones that need updating
    const zonesToUpdate = [];
    let totalAddressesUpdated = 0;

    // Search through all zones for matching addresses
    for (const zone of zones) {
      const addresses = zone.addresses || [];
      let zoneModified = false;
      let addressesUpdatedInZone = 0;

      // Update addresses that match the coordinates
      const updatedAddresses = addresses.map((addr: AddressObject) => {
        if (coordinatesMatch(addr.lat, addr.long, addressToExclude.lat, addressToExclude.long)) {
          zoneModified = true;
          addressesUpdatedInZone++;
          totalAddressesUpdated++;

          // Update status to Opt-out and change createdBy to current user
          return {
            ...addr,
            status: 'Opt-out',
            createdBy: userProfile
          };
        }
        return addr;
      });

      // If this zone had matching addresses, add to update list
      if (zoneModified) {
        zonesToUpdate.push({
          zoneId: zone.id,
          zoneName: zone.zone_name,
          campaignId: zone.campaign_id,
          updatedAddresses: updatedAddresses,
          addressesUpdatedCount: addressesUpdatedInZone
        });
      }
    }

    // If no matches found
    if (zonesToUpdate.length === 0) {
      return successResponse(
        {
          status: "success",
          message: "Address not found in any accessible zones",
          zonesSearched: zones.length,
          zonesUpdated: [],
          addressesUpdated: 0,
          processingTimeMs: Date.now() - startTime
        },
        200
      );
    }

    // Update all zones that had matching addresses
    const updatePromises = zonesToUpdate.map(async (zoneUpdate) => {
      const { error: updateError } = await supabase
        .from("location_zones")
        .update({ addresses: zoneUpdate.updatedAddresses })
        .eq("id", zoneUpdate.zoneId);

      if (updateError) {
        console.error(`Error updating zone ${zoneUpdate.zoneId}:`, updateError);
        throw new Error(`Failed to update zone ${zoneUpdate.zoneName}`);
      }

      return {
        zone_id: zoneUpdate.zoneId,
        zone_name: zoneUpdate.zoneName,
        campaign_id: zoneUpdate.campaignId,
        addresses_updated: zoneUpdate.addressesUpdatedCount
      };
    });

    // Execute all updates
    const updatedZones = await Promise.all(updatePromises);

    const processingTimeMs = Date.now() - startTime;

    // Create notification for address opt-out (for MARKETER and ADMIN)
    if (totalAddressesUpdated > 0) {
      await createNotification({
        supabase,
        organizationId,
        notificationType: "ADDRESS_OPTED_OUT",
        title: "Address Opted Out",
        description: `Address "${addressToExclude.address}" has been opted out in ${updatedZones.length} zone(s)`,
        targetRoles: ROLES.MARKETER_AND_ADMIN,
        metadata: {
          address: addressToExclude.address,
          lat: addressToExclude.lat,
          long: addressToExclude.long,
          zones_updated: updatedZones.length,
          addresses_updated: totalAddressesUpdated
        }
      });
    }

    // Build response
    const response = {
      status: "success",
      message: `Address successfully excluded in ${updatedZones.length} zone(s)`,
      address: {
        lat: addressToExclude.lat,
        long: addressToExclude.long,
        address: addressToExclude.address
      },
      zonesSearched: zones.length,
      zonesUpdated: updatedZones,
      addressesUpdated: totalAddressesUpdated,
      processingTimeMs
    };

    return successResponse(response, 200);

  } catch (error) {
    console.error("Unexpected error in excludeAddress:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
