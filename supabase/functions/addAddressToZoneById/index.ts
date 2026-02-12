import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest, getUserProfile } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * Add Address To Zone By ID Edge Function
 * Adds a single address to an existing location zone
 *
 * Business Rules:
 * - Validates and geocodes address using Google Maps API
 * - Formats address to match zone's address structure
 * - Zone must belong to user's organization
 * - Adds address to zone's addresses JSONB array
 * - Marks new address as "Opt-out" status by default
 * - Requires Google Maps API key in request
 *
 * Request body:
 * {
 *   "zone_id": "uuid",
 *   "street_address": "1024 Alta Ave",
 *   "city": "Mountain View",
 *   "state": "CA",
 *   "zip": "94043",
 *   "googleMapsApiKey": "YOUR_API_KEY"
 * }
 */

interface RequestBody {
  zone_id: string;
  street_address: string;
  city: string;
  state: string;
  zip: string;
  googleMapsApiKey: string;
}

interface GoogleGeocodeResult {
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  formatted_address: string;
  address_components: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
  types: string[];
}

// Determine property type based on Google Maps result
function determinePropertyType(result: GoogleGeocodeResult): string {
  const types = result.types || [];

  if (types.includes('street_address') || types.includes('premise')) {
    return 'Single Family Home';
  } else if (types.includes('subpremise')) {
    return 'Apartment/Condo';
  } else if (types.includes('establishment')) {
    return 'Commercial';
  }

  return 'Unknown';
}

// Check if address is residential
function isResidential(result: GoogleGeocodeResult): boolean {
  const types = result.types || [];
  return types.includes('street_address') ||
         types.includes('premise') ||
         types.includes('subpremise');
}

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c); // Distance in meters
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

    // Validate required fields
    const { zone_id, street_address, city, state, zip, googleMapsApiKey } = requestBody;

    if (!zone_id || typeof zone_id !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "zone_id is required and must be a string",
        400
      );
    }

    if (!street_address || typeof street_address !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "street_address is required and must be a string",
        400
      );
    }

    if (!city || typeof city !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "city is required and must be a string",
        400
      );
    }

    if (!state || typeof state !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "state is required and must be a string",
        400
      );
    }

    if (!zip || typeof zip !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "zip is required and must be a string",
        400
      );
    }

    if (!googleMapsApiKey || typeof googleMapsApiKey !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "googleMapsApiKey is required and must be a string",
        400
      );
    }

    // Fetch zone from database and verify ownership
    const { data: zone, error: zoneError } = await supabase
      .from("location_zones")
      .select("*")
      .eq("id", zone_id)
      .eq("organization_id", organizationId)
      .single();

    if (zoneError || !zone) {
      return errorResponse(
        "ZONE_NOT_FOUND",
        "Zone not found or doesn't belong to your organization",
        404
      );
    }

    // Build full address string for geocoding
    const fullAddress = `${street_address}, ${city}, ${state} ${zip}, USA`;

    // Geocode address using Google Maps Geocoding API
    let geocodeResponse: Response;
    try {
      const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${googleMapsApiKey}`;

      geocodeResponse = await fetch(geocodeUrl);
    } catch (fetchError) {
      console.error("Error calling Google Maps API:", fetchError);
      return errorResponse(
        "GOOGLE_MAPS_API_ERROR",
        "Failed to connect to Google Maps API",
        500
      );
    }

    if (!geocodeResponse.ok) {
      return errorResponse(
        "GOOGLE_MAPS_API_ERROR",
        `Google Maps API returned error: ${geocodeResponse.status}`,
        500
      );
    }

    let geocodeData: any;
    try {
      geocodeData = await geocodeResponse.json();
    } catch (jsonError) {
      console.error("Error parsing Google Maps response:", jsonError);
      return errorResponse(
        "GOOGLE_MAPS_RESPONSE_ERROR",
        "Failed to parse Google Maps API response",
        500
      );
    }

    // Check geocoding status
    if (geocodeData.status !== 'OK') {
      if (geocodeData.status === 'ZERO_RESULTS') {
        return errorResponse(
          "INVALID_ADDRESS",
          "Address is invalid or could not be found",
          400
        );
      } else if (geocodeData.status === 'REQUEST_DENIED') {
        return errorResponse(
          "GOOGLE_MAPS_API_ERROR",
          "Google Maps API key is invalid or request was denied",
          403
        );
      } else {
        return errorResponse(
          "GOOGLE_MAPS_API_ERROR",
          `Google Maps API error: ${geocodeData.status}`,
          500
        );
      }
    }

    const result: GoogleGeocodeResult = geocodeData.results[0];
    const location = result.geometry.location;

    // Extract zone center from zone data
    const zoneCenter = zone.center as { lat: number; long: number };

    // Validate zone center has required fields
    if (!zoneCenter || typeof zoneCenter.lat !== 'number' || typeof zoneCenter.long !== 'number') {
      console.error("Invalid zone center:", zoneCenter);
      return errorResponse(
        "INVALID_ZONE_DATA",
        "Zone has invalid or missing center coordinates",
        500
      );
    }

    // Calculate distance from zone center
    const distanceFromCenter = calculateDistance(
      zoneCenter.lat,
      zoneCenter.long,
      location.lat,
      location.lng
    );

    // Determine zone type string
    const metadata = zone.metadata as any;
    let zoneTypeStr = '';
    if (zone.mode === 'radius' && metadata?.radius) {
      const radiusKm = (metadata.radius / 1000).toFixed(1);
      zoneTypeStr = `radius(${radiusKm}km)`;
    } else if (zone.mode === 'count' && metadata?.count) {
      zoneTypeStr = `count(${metadata.count})`;
    } else {
      // Fallback if metadata is missing
      zoneTypeStr = zone.mode === 'radius' ? 'radius(0.0km)' : 'count(0)';
    }

    // Get targeting zone name
    const targetingZoneName = `Zone at ${zoneCenter.lat.toFixed(4)}, ${zoneCenter.long.toFixed(4)}`;

    // Create new address object
    const newAddress = {
      lat: location.lat,
      long: location.lng,
      address: result.formatted_address,
      residential: isResidential(result),
      building_type: isResidential(result) ? 'house' : 'commercial',
      osm_id: '', // Not available from Google Maps
      propertyType: determinePropertyType(result),
      distanceFromCenter: distanceFromCenter,
      targeting_zone_name: targetingZoneName,
      campaigns_used_in: [],
      zoneType: zoneTypeStr,
      postcards_sent: 0,
      first_post_card_sent_date: null,
      status: 'Opt-out' as const,
      createdBy: userProfile,
      manual_entry: true
    };

    // Get existing addresses array (might be object or array)
    let existingAddresses: any[] = [];
    if (Array.isArray(zone.addresses)) {
      existingAddresses = zone.addresses;
    } else if (zone.addresses && typeof zone.addresses === 'object') {
      // Convert object to array if needed
      existingAddresses = Object.values(zone.addresses);
    }

    // Check for duplicate address (same lat/lng)
    const isDuplicate = existingAddresses.some(addr =>
      Math.abs(addr.lat - newAddress.lat) < 0.00001 &&
      Math.abs(addr.long - newAddress.long) < 0.00001
    );

    if (isDuplicate) {
      return errorResponse(
        "DUPLICATE_ADDRESS",
        "This address already exists in the zone",
        400
      );
    }

    // Add new address to array
    const updatedAddresses = [...existingAddresses, newAddress];

    // Update zone with new address
    const { data: updatedZone, error: updateError } = await supabase
      .from("location_zones")
      .update({
        addresses: updatedAddresses,
        updated_at: new Date().toISOString()
      })
      .eq("id", zone_id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating zone:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to add address to zone",
        500
      );
    }

    const processingTimeMs = Date.now() - startTime;

    // Create notification for new address added (for MARKETER and ADMIN)
    const zoneName = updatedZone.zone_name || `Zone ${zone_id.substring(0, 8)}`;
    await createNotification({
      supabase,
      organizationId,
      notificationType: "NEW_ADDRESS_ADDED",
      title: "New Address Added",
      description: `New address "${newAddress.address}" added to targeting zone "${zoneName}"`,
      targetRoles: ROLES.MARKETER_AND_ADMIN,
      metadata: {
        zone_id: updatedZone.id,
        zone_name: zoneName,
        address: newAddress.address,
        lat: newAddress.lat,
        long: newAddress.long,
        total_addresses: updatedAddresses.length
      }
    });

    return successResponse({
      status: "success",
      message: "Address added to zone successfully",
      data: {
        zone_id: updatedZone.id,
        address_added: newAddress,
        total_addresses: updatedAddresses.length
      },
      processingTimeMs
    }, 201);

  } catch (error) {
    console.error("Unexpected error in addAddressToZoneById:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
