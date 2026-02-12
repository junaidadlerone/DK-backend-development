import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest, getUserProfile } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { CreatedByInfo } from "../_shared/types.ts";
import { createNotification, ROLES } from "../_shared/notifications.ts";

/**
 * Get Addresses From Zone Edge Function
 * Discovers buildings/addresses within a specified zone using OpenStreetMap
 *
 * Business Rules:
 * - Supports two input modes: radius-based or count-based
 * - Accepts address as lat,lng string or full text address
 * - Uses OpenStreetMap to geocode text addresses
 * - Uses OpenStreetMap Overpass API to find buildings
 * - No Google Maps dependency
 * - Requires authentication
 * - campaign_id is optional - if provided, zone is linked to campaign; if not, zone can be linked later
 * - Saves zone to location_zones table and returns zone_id
 *
 * Request body:
 * {
 *   "address": "lat,lng" | "full address string",
 *   "data": {
 *     "radius": number (meters, max 50000) OR
 *     "count": number (max buildings to return),
 *     "searchType": "ALL" | "RESIDENTIAL" | "OTHER" (optional, default: "ALL")
 *   },
 *   "campaign_id": "uuid" (optional - if not provided, zone is marked as manual_search)
 * }
 *
 * Note: manual_search is auto-determined:
 * - If campaign_id is NOT provided: manual_search = true
 * - If campaign_id is provided: manual_search = false
 */

interface LocationData {
  lat: number;
  lng: number;
}

interface AddressResult {
  lat: number;
  long: number;
  address: string;
  residential: boolean;
  building_type?: string;
  osm_id?: string;
  propertyType: string;
  distanceFromCenter: number;
  targeting_zone_name: string;
  campaigns_used_in: string[];
  zoneType: string;
  postcards_sent: number;
  first_post_card_sent_date: string | null;
  status: 'Valid' | 'Duplicate' | 'Opt-out' | 'Unverified';
  createdBy: CreatedByInfo;
}

// Parse address input (lat,lng or text address)
async function parseAddress(address: string): Promise<LocationData | null> {
  // Check if it's lat,lng format
  const latLngPattern = /^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/;
  const match = address.trim().match(latLngPattern);

  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);

    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }

  // It's a text address - geocode using OpenStreetMap Nominatim
  try {
    const encodedAddress = encodeURIComponent(address);
    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1`;

    const response = await fetch(geocodeUrl, {
      headers: {
        'User-Agent': 'DoorKnockerApp/1.0'
      }
    });

    if (!response.ok) {
      console.error('Nominatim geocoding failed:', response.statusText);
      return null;
    }

    const results = await response.json();

    if (results.length === 0) {
      return null;
    }

    const result = results[0];
    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon)
    };
  } catch (error) {
    console.error('Error geocoding address:', error);
    return null;
  }
}

// Fetch buildings from OpenStreetMap Overpass API
async function fetchOpenStreetMapBuildings(
  lat: number,
  lng: number,
  radius: number
): Promise<any[]> {
  // Overpass QL query to find buildings within radius
  const query = `
    [out:json][timeout:90];
    (
      way["building"](around:${radius},${lat},${lng});
      relation["building"](around:${radius},${lat},${lng});
    );
    out center;
  `;

  const overpassUrl = 'https://overpass-api.de/api/interpreter';

  try {
    const response = await fetch(overpassUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `data=${encodeURIComponent(query)}`
    });

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.elements || [];
  } catch (error) {
    console.error('Error fetching from Overpass API:', error);
    throw error;
  }
}

// Building type classifications from OpenStreetMap
const RESIDENTIAL_BUILDINGS = [
  'apartments', 'barracks', 'bungalow', 'cabin', 'detached', 'annexe',
  'dormitory', 'farm', 'ger', 'hotel', 'house', 'houseboat', 'residential',
  'semidetached_house', 'static_caravan', 'stilt_house', 'terrace',
  'tree_house', 'trullo'
];

const OTHER_BUILDINGS = [
  // Commercial
  'commercial', 'industrial', 'kiosk', 'office', 'retail', 'supermarket', 'warehouse',
  // Religious
  'cathedral', 'chapel', 'church', 'kingdom_hall', 'monastery', 'mosque',
  'presbytery', 'shrine', 'synagogue', 'temple',
  // Civic/Amenity
  'bakehouse', 'bridge', 'civic', 'clock_tower', 'college', 'fire_station',
  'government', 'gatehouse', 'hospital', 'kindergarten', 'museum', 'public',
  'school', 'toilets', 'train_station', 'transportation', 'university',
  // Agricultural
  'barn', 'conservatory', 'cowshed', 'farm_auxiliary', 'greenhouse',
  'slurry_tank', 'stable', 'sty', 'livestock',
  // Sports
  'grandstand', 'pavilion', 'riding_hall', 'sports_hall', 'sports_centre', 'stadium',
  // Storage
  'allotment_house', 'boathouse', 'hangar', 'hut', 'shed',
  // Cars
  'carport', 'garage', 'garages', 'parking',
  // Power/Technical
  'digester', 'service', 'tech_cab', 'transformer_tower', 'water_tower',
  'storage_tank', 'silo',
  // Other
  'beach_hut', 'bunker', 'castle', 'construction', 'container', 'guardhouse',
  'military', 'outbuilding', 'pagoda', 'quonset_hut', 'roof', 'ruins',
  'ship', 'tent', 'tower', 'triumphal_arch', 'windmill', 'yes'
];

// Convert OSM element to address object (optimized hybrid approach)
async function convertOsmToAddress(
  element: any,
  googleApiKey?: string,
  centerLat?: number,
  centerLng?: number,
  zoneName?: string,
  zoneTypeStr?: string,
  createdBy?: CreatedByInfo
): Promise<AddressResult | null> {
  // Get center coordinates
  let lat: number, lng: number;

  if (element.center) {
    lat = element.center.lat;
    lng = element.center.lon;
  } else if (element.lat && element.lon) {
    lat = element.lat;
    lng = element.lon;
  } else {
    return null;
  }

  // Determine if residential using the comprehensive building type lists
  const buildingType = element.tags?.building || 'yes';
  const isResidential = RESIDENTIAL_BUILDINGS.includes(buildingType.toLowerCase());

  let address = '';
  const tags = element.tags || {};

  // Strategy 1: Use OSM tags if available (instant, no API calls)
  if (tags['addr:housenumber'] && tags['addr:street']) {
    // Build address from OSM tags
    const parts = [tags['addr:housenumber'], tags['addr:street']];
    if (tags['addr:city']) parts.push(tags['addr:city']);
    if (tags['addr:state']) parts.push(tags['addr:state']);
    if (tags['addr:postcode']) parts.push(tags['addr:postcode']);
    address = parts.join(', ');
  } else if (tags['addr:street']) {
    // At least have street
    const parts = [tags['addr:street']];
    if (tags['addr:city']) parts.push(tags['addr:city']);
    if (tags['addr:state']) parts.push(tags['addr:state']);
    address = parts.join(', ');
  } else if (tags.name) {
    // Use building name
    address = tags.name;
  }

  // Strategy 2: Only geocode if no OSM address and Google API key provided
  if (!address && googleApiKey) {
    try {
      const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleApiKey}`;
      const response = await fetch(googleUrl);

      if (response.ok) {
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          address = data.results[0].formatted_address;
        }
      }
    } catch (error) {
      console.error('Google Maps geocoding failed:', error);
    }
  }

  // Final fallback: use coordinates
  if (!address) {
    address = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }

  // Calculate distance from center if center coordinates are provided
  const distanceFromCenter = (centerLat && centerLng) ? 
    Math.round(
      Math.sqrt(
        Math.pow((lat - centerLat) * 111320, 2) + // Convert lat to meters (approximate)
        Math.pow((lng - centerLng) * 111320 * Math.cos(centerLat * Math.PI / 180), 2) // Convert lng to meters
      )
    ) : 0;

  // Determine property type from building type
  const propertyType = isResidential 
    ? (buildingType === 'house' ? 'Single Family Home' : 
       buildingType === 'apartments' ? 'Apartment Building' :
       buildingType === 'dormitory' ? 'Dormitory' :
       buildingType === 'residential' ? 'Residential Building' : 'Residential')
    : (buildingType === 'office' ? 'Office Building' :
       buildingType === 'commercial' ? 'Commercial Building' :
       buildingType === 'retail' ? 'Retail Building' :
       buildingType === 'warehouse' ? 'Warehouse' :
       buildingType === 'industrial' ? 'Industrial Building' : 'Commercial');

  // Default createdBy if not provided
  const defaultCreatedBy: CreatedByInfo = createdBy || {
    id: 'unknown',
    user_role: 'TECHNICIAN',
    full_name: 'Unknown User',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  return {
    lat,
    long: lng,
    address,
    residential: isResidential,
    building_type: buildingType,
    osm_id: element.id?.toString(),
    propertyType: propertyType,
    distanceFromCenter: distanceFromCenter,
    targeting_zone_name: zoneName || 'Unnamed Zone',
    campaigns_used_in: [],
    zoneType: zoneTypeStr || 'radius',
    postcards_sent: 0,
    first_post_card_sent_date: null,
    status: 'Unverified' as const,
    createdBy: defaultCreatedBy
  };
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
    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON format in request body",
        400
      );
    }

    const { address, data, campaign_id } = body;
    const searchType = data?.searchType || body.searchType || "ALL";
    // Auto-determine manual_search based on campaign_id presence
    const isManualSearch = !campaign_id; // true if no campaign_id, false if campaign_id provided

    // Get optional Google API key from headers
    const googleApiKey = req.headers.get("x-google-api-key");

    // Create Supabase client
    const supabase = createSupabaseClient();

    // Get user from request
    const user = getUserFromRequest(req);
    if (!user) {
      return errorResponse(
        "UNAUTHORIZED",
        "Authentication required",
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

    // Verify campaign exists and belongs to user's organization (only if campaign_id is provided)
    if (campaign_id) {
      const { data: campaign, error: campaignError } = await supabase
        .from("campaigns")
        .select("id")
        .eq("id", campaign_id)
        .eq("organization_id", organizationId)
        .single();

      if (campaignError || !campaign) {
        return errorResponse(
          "CAMPAIGN_NOT_FOUND",
          "Campaign not found in your organization",
          404
        );
      }
    }

    // Validate inputs
    if (!address || typeof address !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "address is required and must be a string (lat,lng or full address)",
        400
      );
    }

    if (!data || typeof data !== 'object') {
      return errorResponse(
        "INVALID_INPUT",
        "data object is required",
        400
      );
    }

    // Validate that either radius OR count is provided, not both
    const hasRadius = data.radius !== undefined;
    const hasCount = data.count !== undefined;

    if (!hasRadius && !hasCount) {
      return errorResponse(
        "INVALID_INPUT",
        "Either data.radius or data.count must be provided",
        400
      );
    }

    if (hasRadius && hasCount) {
      return errorResponse(
        "INVALID_INPUT",
        "Cannot specify both data.radius and data.count. Choose one mode.",
        400
      );
    }

    // Validate radius or count values
    if (hasRadius) {
      if (typeof data.radius !== 'number' || data.radius <= 0 || data.radius > 50000) {
        return errorResponse(
          "INVALID_INPUT",
          "data.radius must be a number between 1 and 50000 meters",
          400
        );
      }
    }

    if (hasCount) {
      if (typeof data.count !== 'number' || data.count <= 0 || data.count > 1000) {
        return errorResponse(
          "INVALID_INPUT",
          "data.count must be a number between 1 and 1000",
          400
        );
      }
    }

    // Validate searchType
    if (!['ALL', 'RESIDENTIAL', 'OTHER'].includes(searchType)) {
      return errorResponse(
        "INVALID_INPUT",
        "searchType must be 'ALL', 'RESIDENTIAL', or 'OTHER'",
        400
      );
    }

    // Parse address to get coordinates
    const location = await parseAddress(address);

    if (!location) {
      return errorResponse(
        "INVALID_ADDRESS",
        "Unable to geocode the provided address. Please use lat,lng format (e.g., '33.1507,-96.8236')",
        400
      );
    }

    const { lat, lng } = location;

    // Generate zone name from address input
    const zoneName = address.includes(',') && !address.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/) 
      ? address.substring(0, 50) // Use first 50 chars if it's a text address
      : `Zone at ${lat.toFixed(4)}, ${lng.toFixed(4)}`; // Generate name from coordinates

    // Generate zone type string
    const zoneTypeStr = hasRadius 
      ? `radius(${(data.radius / 1000).toFixed(1)}km)` 
      : `point(${data.count} addresses)`;

    // Determine search radius
    let searchRadius = hasRadius ? data.radius : 2000; // Smaller default radius for count mode (2km instead of 5km)

    // If using count mode, we'll fetch within radius and then limit results
    const targetCount = hasCount ? data.count : null;

    // Fetch buildings from OpenStreetMap
    let osmElements: any[];
    try {
      osmElements = await fetchOpenStreetMapBuildings(lat, lng, searchRadius);
    } catch (error) {
      return errorResponse(
        "OSM_API_ERROR",
        `Failed to fetch buildings from OpenStreetMap: ${error.message}`,
        500
      );
    }

    // In count mode, limit how many buildings we process to avoid timeouts
    // Process more than requested to account for filtering, but not everything
    if (targetCount !== null) {
      const maxToProcess = Math.min(osmElements.length, targetCount * 3); // Process 3x the target to account for filtering
      osmElements = osmElements.slice(0, maxToProcess);
    }

    // Convert OSM elements to addresses (optimized hybrid approach)
    // First, separate buildings with and without OSM address tags
    const buildingsWithAddress: any[] = [];
    const buildingsNeedingGeocode: any[] = [];

    for (const element of osmElements) {
      const tags = element.tags || {};
      // Check if building has address tags in OSM
      if (tags['addr:housenumber'] || tags['addr:street'] || tags.name) {
        buildingsWithAddress.push(element);
      } else {
        buildingsNeedingGeocode.push(element);
      }
    }

    const addresses: AddressResult[] = [];

    // Process buildings with OSM addresses instantly (no API calls)
    for (const element of buildingsWithAddress) {
      const result = await convertOsmToAddress(element, undefined, lat, lng, zoneName, zoneTypeStr, userProfile);
      if (result) addresses.push(result);
    }

    // Geocode remaining buildings in parallel (much faster)
    if (buildingsNeedingGeocode.length > 0 && googleApiKey) {
      const geocodeResults = await Promise.all(
        buildingsNeedingGeocode.map(element => convertOsmToAddress(element, googleApiKey, lat, lng, zoneName, zoneTypeStr, userProfile))
      );
      addresses.push(...geocodeResults.filter(addr => addr !== null));
    } else if (buildingsNeedingGeocode.length > 0) {
      // No Google API key - process without geocoding
      for (const element of buildingsNeedingGeocode) {
        const result = await convertOsmToAddress(element, undefined, lat, lng, zoneName, zoneTypeStr, userProfile);
        if (result) addresses.push(result);
      }
    }

    // Filter by searchType
    let filteredAddresses = addresses;
    if (searchType === 'RESIDENTIAL') {
      filteredAddresses = addresses.filter(addr => addr.residential === true);
    } else if (searchType === 'OTHER') {
      filteredAddresses = addresses.filter(addr => addr.residential === false);
    }

    // If count mode, limit to requested count
    if (targetCount !== null && filteredAddresses.length > targetCount) {
      // Sort by distance from center (closest first)
      filteredAddresses = filteredAddresses
        .map(addr => {
          const distance = Math.sqrt(
            Math.pow(addr.lat - lat, 2) + Math.pow(addr.long - lng, 2)
          );
          return { ...addr, _distance: distance };
        })
        .sort((a, b) => a._distance - b._distance)
        .slice(0, targetCount)
        .map(({ _distance, ...addr }) => addr); // Remove distance field
    }

    const processingTimeMs = Date.now() - startTime;

    // Prepare response data
    const responseData = {
      status: "success",
      message: `Found ${filteredAddresses.length} addresses`,
      center: {
        lat,
        long: lng,
        ...(hasRadius ? { radius: data.radius } : {})
      },
      mode: hasRadius ? 'radius' : 'count',
      searchType,
      metadata: {
        totalBuildingsFound: osmElements.length,
        addressesReturned: filteredAddresses.length,
        residentialCount: filteredAddresses.filter(addr => addr.residential).length,
        otherCount: filteredAddresses.filter(addr => !addr.residential).length,
        processingTimeMs
      },
      addresses: filteredAddresses
    };

    // If campaign_id is provided, unlink ALL existing zones from this campaign first
    // This ensures only the newest search zone is linked to the campaign
    if (campaign_id) {
      const { error: unlinkError } = await supabase
        .from("location_zones")
        .update({ campaign_id: null })
        .eq("organization_id", organizationId)
        .eq("campaign_id", campaign_id);

      if (unlinkError) {
        console.error("Error unlinking existing zones from campaign:", unlinkError);
        // Don't fail the request, just log the error
      }
    }

    // Save to location_zones table
    const { data: zoneData, error: insertError } = await supabase
      .from("location_zones")
      .insert({
        campaign_id: campaign_id || null, // Allow null if campaign_id not provided
        organization_id: organizationId,
        center: responseData.center,
        mode: responseData.mode,
        search_type: searchType,
        metadata: responseData.metadata,
        addresses: filteredAddresses,
        zone_name: zoneName,
        zone_type: zoneTypeStr,
        address: address, // Save the original address input
        manual_search: isManualSearch // Save manual search indicator
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Error saving zone to database:", insertError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to save zone to database",
        500
      );
    }

    // Update campaign with zone_id (only if campaign_id was provided)
    if (campaign_id) {
      const { error: updateCampaignError } = await supabase
        .from("campaigns")
        .update({ zone_id: zoneData.id })
        .eq("id", campaign_id)
        .eq("organization_id", organizationId);

      if (updateCampaignError) {
        console.error("Error updating campaign with zone_id:", updateCampaignError);
        // Don't fail the request, just log the error since zone was created successfully
      }
    }

    // Create notification for new targeting zone (for MARKETER and ADMIN)
    await createNotification({
      supabase,
      organizationId,
      notificationType: "NEW_TARGETING_ZONE_CREATED",
      title: "New Targeting Zone Created",
      description: `New targeting zone "${zoneName}" created with ${filteredAddresses.length} addresses`,
      targetRoles: ROLES.MARKETER_AND_ADMIN,
      metadata: {
        zone_id: zoneData.id,
        zone_name: zoneName,
        zone_type: zoneTypeStr,
        addresses_count: filteredAddresses.length,
        campaign_id: campaign_id || null,
        center_lat: lat,
        center_lng: lng,
        radius: hasRadius ? data.radius : null
      }
    });

    // Build response
    return successResponse(
      {
        ...responseData,
        zone_id: zoneData.id
      },
      200
    );

  } catch (error) {
    console.error("Unexpected error in getAddressesFromZone:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
