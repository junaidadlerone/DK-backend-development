import {
  corsResponse,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { CreatedByInfo } from "../_shared/types.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get All Addresses Edge Function
 * Returns all addresses from all zones in the user's organization
 *
 * Business Rules:
 * - Returns addresses from all location zones in the organization
 * - Query parameter `showAll=true` returns addresses from all zones (including zones without campaign_id)
 * - Without `showAll` parameter, returns only addresses from zones with campaign_id (linked to campaigns)
 * - NEVER returns addresses with "Unverified" status (always excluded)
 * - Optional filtering: showOnlyExclusions to filter to only Duplicate and Opt-out addresses
 * - Organization-based (user must be authenticated and in organization)
 * - Includes zone metadata for each address
 * - Deduplicates addresses across zones (if same lat/lng exists in multiple zones)
 *
 * Request body (optional):
 * {
 *   "showOnlyExclusions": boolean (optional, default: false)
 *   // true = only return Duplicate and Opt-out (excludes Valid and Unverified)
 *   // false = return Valid, Duplicate, Opt-out (excludes Unverified)
 * }
 */

interface EnhancedAddress {
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
  status: "Valid" | "Duplicate" | "Opt-out" | "Unverified";
  createdBy: CreatedByInfo & { created_at_tz?: string; updated_at_tz?: string };
  // Additional metadata
  zone_id: string;
  zone_name: string;
  campaign_id?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Allow both GET and POST requests
  if (req.method !== "GET" && req.method !== "POST") {
    return errorResponse(
      "METHOD_NOT_ALLOWED",
      "Only GET and POST methods are allowed",
      405,
    );
  }

  const startTime = Date.now();

  try {
    // Parse query parameters
    const url = new URL(req.url);
    const showAll = url.searchParams.get("showAll") === "true";

    // Create Supabase client
    const supabase = createSupabaseClient();

    // Get user from request
    const user = getUserFromRequest(req);
    if (!user) {
      return errorResponse(
        "UNAUTHORIZED",
        "Unable to authenticate user",
        401,
      );
    }

    // Get user's organization
    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403,
      );
    }

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Parse optional request body for filtering
    let showOnlyExclusions = false;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        showOnlyExclusions = body?.showOnlyExclusions === true;
      } catch (parseError) {
        // Ignore parse errors for optional body
        console.log("No body provided or invalid JSON, using defaults");
      }
    }

    // Build query based on showAll parameter
    let query = supabase
      .from("location_zones")
      .select(`
        id,
        campaign_id,
        zone_name,
        zone_type,
        addresses,
        created_at
      `)
      .eq("organization_id", organizationId);

    // If showAll is NOT true, filter to only zones with campaign_id
    if (!showAll) {
      query = query.not("campaign_id", "is", null);
    }

    // Execute query with ordering
    const { data: zones, error: zonesError } = await query
      .order("created_at", { ascending: false });

    if (zonesError) {
      console.error("Error fetching zones:", zonesError);
      return errorResponse(
        "ZONES_FETCH_FAILED",
        "Failed to fetch zones",
        500,
      );
    }

    if (!zones || zones.length === 0) {
      return successResponse(
        {
          status: "success",
          message: "No zones found for organization",
          metadata: {
            total_zones: 0,
            total_addresses: 0,
            addresses_returned: 0,
            showOnlyExclusions: showOnlyExclusions,
            processingTimeMs: Date.now() - startTime,
          },
          addresses: [],
        },
        200,
      );
    }

    // Aggregate all addresses from all zones
    let allAddresses: EnhancedAddress[] = [];
    let totalAddressesBeforeFilter = 0;

    for (const zone of zones) {
      const zoneAddresses = zone.addresses || [];
      totalAddressesBeforeFilter += zoneAddresses.length;

      for (const addr of zoneAddresses) {
        // Default createdBy for backward compatibility with existing addresses
        const defaultCreatedBy: CreatedByInfo = addr.createdBy || {
          id: "legacy",
          user_role: "TECHNICIAN",
          full_name: "Legacy User",
          created_at: addr.created_at || new Date().toISOString(),
          updated_at: addr.updated_at || new Date().toISOString(),
        };

        // Enrich createdBy with timezone info
        const enrichedCreatedBy = {
          ...defaultCreatedBy,
          created_at_tz: enrichTimestamp(
            defaultCreatedBy.created_at,
            preferences.timezone,
          ),
          updated_at_tz: enrichTimestamp(
            defaultCreatedBy.updated_at,
            preferences.timezone,
          ),
        };

        // Ensure the address has all required enhanced fields
        const enhancedAddress: EnhancedAddress = {
          lat: addr.lat,
          long: addr.long,
          address: addr.address,
          residential: addr.residential || false,
          building_type: addr.building_type,
          osm_id: addr.osm_id,
          propertyType: addr.propertyType || "Unknown",
          distanceFromCenter: addr.distanceFromCenter || 0,
          targeting_zone_name: addr.targeting_zone_name || zone.zone_name ||
            "Unnamed Zone",
          campaigns_used_in: Array.isArray(addr.campaigns_used_in)
            ? addr.campaigns_used_in
            : [],
          zoneType: addr.zoneType || zone.zone_type || "unknown",
          postcards_sent: addr.postcards_sent || 0,
          first_post_card_sent_date: addr.first_post_card_sent_date || null,
          status: addr.status || "Unverified",
          createdBy: enrichedCreatedBy,
          // Zone metadata
          zone_id: zone.id,
          zone_name: zone.zone_name || "Unnamed Zone",
          campaign_id: zone.campaign_id,
        };

        allAddresses.push(enhancedAddress);
      }
    }

    // Apply filtering based on showOnlyExclusions
    let filteredAddresses: EnhancedAddress[];
    if (showOnlyExclusions) {
      // Return only non-Valid addresses (Duplicate, Opt-out) - excludes Valid and Unverified
      filteredAddresses = allAddresses.filter((addr) =>
        addr.status !== "Valid" && addr.status !== "Unverified"
      );
    } else {
      // Return all addresses EXCEPT Unverified (Valid, Duplicate, Opt-out only)
      filteredAddresses = allAddresses.filter((addr) =>
        addr.status !== "Unverified"
      );
    }

    // Optional: Remove duplicates based on lat/lng
    // Using a Map to deduplicate by coordinates
    const addressMap = new Map<string, EnhancedAddress>();

    for (const addr of filteredAddresses) {
      const key = `${addr.lat.toFixed(6)},${addr.long.toFixed(6)}`;

      // If duplicate, keep the one with more recent zone (zones are ordered by created_at desc)
      if (!addressMap.has(key)) {
        addressMap.set(key, addr);
      }
      // If we want to track duplicates, we could modify the status here
    }

    const deduplicatedAddresses = Array.from(addressMap.values());

    // Generate status summary
    const statusCounts = {
      Valid: 0,
      Unverified: 0,
      Duplicate: 0,
      "Opt-out": 0,
    };

    allAddresses.forEach((addr) => {
      if (addr.status in statusCounts) {
        statusCounts[addr.status as keyof typeof statusCounts]++;
      }
    });

    const processingTimeMs = Date.now() - startTime;

    // Build response
    const response = {
      status: "success",
      message: showOnlyExclusions
        ? `Found ${deduplicatedAddresses.length} exclusion addresses (Duplicate and Opt-out only, ${
          statusCounts.Duplicate + statusCounts["Opt-out"]
        } total exclusions)`
        : `Found ${deduplicatedAddresses.length} verified addresses from ${zones.length} zones (excludes Unverified)`,
      metadata: {
        total_zones: zones.length,
        total_addresses_before_dedup: totalAddressesBeforeFilter,
        total_addresses_after_dedup: allAddresses.length,
        addresses_returned: deduplicatedAddresses.length,
        showOnlyExclusions: showOnlyExclusions,
        status_breakdown: statusCounts,
        processingTimeMs,
      },
      addresses: deduplicatedAddresses,
    };

    return successResponse(response, 200);
  } catch (error) {
    console.error("Unexpected error in getAllAddresses:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500,
    );
  }
});
