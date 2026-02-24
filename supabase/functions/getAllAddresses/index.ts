import {
  corsResponse,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { CreatedByInfo } from "../_shared/types.ts";
import { enrichTimestamp, TimezoneEnrichment } from "../_shared/timezone.ts";
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
  createdBy: CreatedByInfo & { created_at_tz?: TimezoneEnrichment; updated_at_tz?: TimezoneEnrichment };
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

    // Fetch all zones for the organization
    const { data: zones, error: zonesError } = await supabase
      .from("location_zones")
      .select(`
        id,
        campaign_id,
        zone_name,
        zone_type,
        addresses,
        created_at
      `)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (zonesError) {
      console.error("Error fetching zones:", zonesError);
      return errorResponse(
        "ZONES_FETCH_FAILED",
        "Failed to fetch zones",
        500,
      );
    }

    const zonesMap = new Map();
    for (const zone of zones || []) {
      zonesMap.set(zone.id, zone);
    }

    let allAddresses: EnhancedAddress[] = [];
    let totalAddressesBeforeFilter = 0;

    if (showAll) {
      // Logic for showAll=true: just return everything in the organization (raw zones)
      for (const zone of zones || []) {
        const zoneAddresses = zone.addresses || [];
        totalAddressesBeforeFilter += zoneAddresses.length;

        for (const addr of zoneAddresses) {
          const defaultCreatedBy: CreatedByInfo = addr.createdBy || {
            id: "legacy",
            user_role: "TECHNICIAN",
            full_name: "Legacy User",
            created_at: addr.created_at || new Date().toISOString(),
            updated_at: addr.updated_at || new Date().toISOString(),
          };

          const enrichedCreatedBy = {
            ...defaultCreatedBy,
            created_at_tz: enrichTimestamp(defaultCreatedBy.created_at, preferences.timezone),
            updated_at_tz: enrichTimestamp(defaultCreatedBy.updated_at, preferences.timezone),
          };

          const enhancedAddress: EnhancedAddress = {
            lat: addr.lat,
            long: addr.long,
            address: addr.address,
            residential: addr.residential || false,
            building_type: addr.building_type,
            osm_id: addr.osm_id,
            propertyType: addr.propertyType || "Unknown",
            distanceFromCenter: addr.distanceFromCenter || 0,
            targeting_zone_name: addr.targeting_zone_name || zone.zone_name || "Unnamed Zone",
            campaigns_used_in: Array.isArray(addr.campaigns_used_in) ? addr.campaigns_used_in : [],
            zoneType: addr.zoneType || zone.zone_type || "unknown",
            postcards_sent: addr.postcards_sent || 0,
            first_post_card_sent_date: addr.first_post_card_sent_date || null,
            status: addr.status || "Unverified",
            createdBy: enrichedCreatedBy,
            zone_id: zone.id,
            zone_name: zone.zone_name || "Unnamed Zone",
            campaign_id: zone.campaign_id, // Might be null
          };

          allAddresses.push(enhancedAddress);
        }
      }
    } else {
      // Logic for showAll=false: fetch campaigns and get exactly the addresses mapped to those campaigns
      const { data: campaigns, error: campaignsError } = await supabase
        .from("campaigns")
        .select("id, zone_id")
        .eq("organization_id", organizationId)
        .not("zone_id", "is", null);

      if (campaignsError) {
        console.error("Error fetching campaigns:", campaignsError);
        return errorResponse("CAMPAIGNS_FETCH_FAILED", "Failed to fetch campaigns", 500);
      }

      for (const campaign of campaigns || []) {
        const zone = zonesMap.get(campaign.zone_id);

        if (zone) {
          const zoneAddresses = zone.addresses || [];
          totalAddressesBeforeFilter += zoneAddresses.length;

          for (const addr of zoneAddresses) {
            const defaultCreatedBy: CreatedByInfo = addr.createdBy || {
              id: "legacy",
              user_role: "TECHNICIAN",
              full_name: "Legacy User",
              created_at: addr.created_at || new Date().toISOString(),
              updated_at: addr.updated_at || new Date().toISOString(),
            };

            const enrichedCreatedBy = {
              ...defaultCreatedBy,
              created_at_tz: enrichTimestamp(defaultCreatedBy.created_at, preferences.timezone),
              updated_at_tz: enrichTimestamp(defaultCreatedBy.updated_at, preferences.timezone),
            };

            const enhancedAddress: EnhancedAddress = {
              lat: addr.lat,
              long: addr.long,
              address: addr.address,
              residential: addr.residential || false,
              building_type: addr.building_type,
              osm_id: addr.osm_id,
              propertyType: addr.propertyType || "Unknown",
              distanceFromCenter: addr.distanceFromCenter || 0,
              targeting_zone_name: addr.targeting_zone_name || zone.zone_name || "Unnamed Zone",
              campaigns_used_in: Array.isArray(addr.campaigns_used_in) ? addr.campaigns_used_in : [],
              zoneType: addr.zoneType || zone.zone_type || "unknown",
              postcards_sent: addr.postcards_sent || 0,
              first_post_card_sent_date: addr.first_post_card_sent_date || null,
              status: addr.status || "Unverified",
              createdBy: enrichedCreatedBy,
              zone_id: zone.id,
              zone_name: zone.zone_name || "Unnamed Zone",
              campaign_id: campaign.id, // explicitly set the campaign id mapping it
            };

            allAddresses.push(enhancedAddress);
          }
        }
      }
    }

    // Apply filtering based on showOnlyExclusions
    let filteredAddresses: EnhancedAddress[];
    if (showOnlyExclusions) {
      filteredAddresses = allAddresses.filter((addr) =>
        addr.status !== "Valid" && addr.status !== "Unverified"
      );
    } else {
      filteredAddresses = allAddresses.filter((addr) =>
        addr.status !== "Unverified"
      );
    }

    // Deduplicate based on Lat/Lng ACROSS ALL CAMPAIGNS
    // Keep the first occurrence as Valid, mark subsequent occurrences as Duplicate
    const addressMap = new Map<string, EnhancedAddress>();
    const duplicateAddresses: EnhancedAddress[] = [];

    for (const addr of filteredAddresses) {
      // Use only coordinates for global uniqueness check
      const key = `${addr.lat.toFixed(6)},${addr.long.toFixed(6)}`;

      if (!addressMap.has(key)) {
        addressMap.set(key, addr);
      } else {
        // It's a duplicate coordinate anywhere in the fetched data
        addr.status = "Duplicate";
        duplicateAddresses.push(addr);
      }
    }

    const deduplicatedAddresses = [...Array.from(addressMap.values()), ...duplicateAddresses];

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
