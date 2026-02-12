import {
  corsResponse,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Verify Addresses Edge Function
 * Verifies addresses in a zone using PostGrid API
 *
 * Business Rules:
 * - Takes zone_id to fetch addresses from location_zones table
 * - Verifies each address using PostGrid address verification API
 * - Updates the zone with verified status for each address
 * - Returns response in same format as getAddressesFromZone
 * - Requires PostGrid API key in header
 * - Optional: Filter to show only verified addresses
 *
 * Request body:
 * {
 *   "zone_id": "uuid",
 *   "showOnlyVerified": boolean (optional, default: false)
 * }
 *
 * Headers:
 * - x-postgrid-api-key (REQUIRED) - PostGrid API key for address verification
 */

interface AddressInput {
  lat: number;
  long: number;
  address: string;
  residential: boolean;
  building_type?: string;
  osm_id?: string;
  verified?: boolean;
  verification_details?: any;
  api_response?: any;
}

interface VerifiedAddress extends AddressInput {
  verified: boolean;
  verification_details?: any;
  api_response?: any;
}

/**
 * Parses address string into components for PostGrid
 * Handles formats like:
 * - "Street, City, State ZIP"
 * - "Street, City State ZIP"
 * - "Building at lat, long"
 */
function parseAddress(formattedAddress: string) {
  // Remove country suffix (USA, US, etc.)
  const withoutCountry = formattedAddress.replace(
    /, (USA|US|United States)$/i,
    "",
  ).trim();

  // Split by comma
  const parts = withoutCountry.split(",").map((p) => p.trim());

  if (parts.length >= 3) {
    // Format: "Street, City, State ZIP"
    const line1 = parts[0];
    const city = parts[1];
    const stateZip = parts[2].split(" ");
    // Handle "State ZIP" or just "State" (though rare for verified input)
    const provinceOrState = stateZip[0];
    const postalOrZip = stateZip.slice(1).join(" ");

    return {
      line1,
      city,
      provinceOrState,
      postalOrZip,
      country: "US",
    };
  } else if (parts.length === 2) {
    // Format: "Street, City State ZIP" or "Street, City"
    const line1 = parts[0];
    const secondPart = parts[1];
    const secondPartSplit = secondPart.split(" ");

    // Heuristic: If second part has spaces, it might be "City State ZIP" or "City Name State ZIP"
    // But commonly "City State Zip" -> last is zip, second to last is state
    if (secondPartSplit.length >= 2) {
      const zip = secondPartSplit[secondPartSplit.length - 1];
      const state = secondPartSplit[secondPartSplit.length - 2];
      // Simple heuristic: zip is usually numeric, state is 2 chars

      const cityWords = secondPartSplit.slice(0, -2);
      const city = cityWords.length > 0 ? cityWords.join(" ") : secondPart;

      // If we couldn't extract a clear zip/state, fall back to "City" assumption
      // validation usually fails if components are wrong, better to try parsing than failing early
      return {
        line1,
        city,
        provinceOrState: state,
        postalOrZip: zip,
        country: "US",
      };
    } else {
      // Just "Street, City" - unlikely to verify without state/zip but we send what we have
      return {
        line1,
        city: secondPart,
        provinceOrState: "",
        postalOrZip: "",
        country: "US",
      };
    }
  }

  // Fallback: send entire address as line1
  return {
    line1: formattedAddress,
    city: "",
    provinceOrState: "",
    postalOrZip: "",
    country: "US",
  };
}

// Verify single address with PostGrid
async function verifyWithPostGrid(
  address: AddressInput,
  postgridApiKey: string,
): Promise<VerifiedAddress> {
  try {
    // Parse the address into components
    const addressComponents = parseAddress(address.address);

    console.log(`Verifying address: ${address.address}`, { addressComponents });

    // PostGrid expects payload format: {address: {components}}
    const response = await fetch(
      "https://api.postgrid.com/v1/addver/verifications",
      {
        method: "POST",
        headers: {
          "x-api-key": postgridApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: addressComponents,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `PostGrid verification failed for address: ${address.address}`,
        {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          addressComponents,
        },
      );
      return {
        ...address,
        verified: false,
        status: "Unverified", // Ensure status field is present
        verification_details: {
          error: `PostGrid API error: ${response.statusText}`,
          status_code: response.status,
          details: errorText,
        },
      };
    }

    const result = await response.json();
    console.log("PostGrid response:", result);
    const data = result.data;

    // Accept both 'verified' and 'corrected' as valid
    const verified = data.status === "verified" || data.status === "corrected";

    // Reconstruct full address from PostGrid response
    const verifiedAddress =
      `${data.line1}, ${data.city}, ${data.provinceOrState} ${data.postalOrZip}`;

    return {
      ...address,
      original_address: address.address, // Keep original
      address: verifiedAddress,
      verified,
      status: verified ? "Valid" : "Unverified",
      verification_details: {
        status: data.status,
        line1: data.line1,
        city: data.city,
        provinceOrState: data.provinceOrState,
        postalOrZip: data.postalOrZip,
        details: data, // Include full details
      },
    };
  } catch (error) {
    console.error("Error verifying address with PostGrid:", error);
    return {
      ...address,
      verified: false,
      status: "Unverified",
      verification_details: {
        error: error.message,
      },
    };
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return errorResponse(
      "METHOD_NOT_ALLOWED",
      "Only POST method is allowed",
      405,
    );
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

    // Get PostGrid API key from headers
    const postgridApiKey = req.headers.get("x-postgrid-api-key");
    if (!postgridApiKey) {
      return errorResponse(
        "MISSING_API_KEY",
        "PostGrid API key is required in x-postgrid-api-key header",
        400,
      );
    }

    // Parse request body
    let body: any;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON format in request body",
        400,
      );
    }

    const { zone_id, showOnlyVerified = false } = body;

    // Validate inputs
    if (!zone_id) {
      return errorResponse(
        "INVALID_INPUT",
        "zone_id is required",
        400,
      );
    }

    // Fetch zone from database and verify it belongs to user's organization
    const { data: zone, error: zoneError } = await supabase
      .from("location_zones")
      .select(`
        id,
        campaign_id,
        organization_id,
        center,
        mode,
        search_type,
        metadata,
        addresses,
        zone_name,
        zone_type,
        address
      `)
      .eq("id", zone_id)
      .eq("organization_id", organizationId)
      .single();

    if (zoneError || !zone) {
      console.error("Error fetching zone:", zoneError);
      return errorResponse(
        "ZONE_NOT_FOUND",
        "Zone not found in your organization",
        404,
      );
    }

    // Get addresses from zone
    const addresses = zone.addresses || [];

    if (addresses.length === 0) {
      return errorResponse(
        "INVALID_INPUT",
        "Zone has no addresses to verify",
        400,
      );
    }

    // Increased limit to 10,000 to support larger zones
    if (addresses.length > 10000) {
      return errorResponse(
        "INVALID_INPUT",
        "Cannot verify more than 10,000 addresses at once",
        400,
      );
    }

    console.log(
      `Starting verification for ${addresses.length} addresses in zone ${zone_id}`,
    );

    // Process in batches of 20 to respect API rate limits
    const BATCH_SIZE = 20;
    const verifiedAddresses: VerifiedAddress[] = [];

    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
      const batch = addresses.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map((addr: AddressInput) =>
        verifyWithPostGrid(addr, postgridApiKey)
      );

      const batchResults = await Promise.all(batchPromises);
      verifiedAddresses.push(...batchResults);

      // Optional small delay between batches if needed to stay under rate limits
      // await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Count verification results
    const verifiedCount = verifiedAddresses.filter((addr) =>
      addr.verified === true
    ).length;
    const unverifiedCount = verifiedAddresses.length - verifiedCount;

    console.log(
      `Verification complete: ${verifiedCount} verified, ${unverifiedCount} unverified`,
    );

    // Update zone in database with verified addresses
    const { error: updateError } = await supabase
      .from("location_zones")
      .update({
        addresses: verifiedAddresses,
        updated_at: new Date().toISOString(),
      })
      .eq("id", zone_id);

    if (updateError) {
      console.error(
        "Error updating zone with verified addresses:",
        updateError,
      );
      // Don't fail the request, just log the error
    }

    const processingTimeMs = Date.now() - startTime;

    // Filter addresses if showOnlyVerified is true
    const addressesToReturn = showOnlyVerified
      ? verifiedAddresses.filter((addr) => addr.verified === true)
      : verifiedAddresses;

    // Build response in same format as getAddressesFromZone
    return successResponse(
      {
        status: "success",
        message: showOnlyVerified
          ? `Returning ${addressesToReturn.length} verified addresses (${verifiedCount} total verified, ${unverifiedCount} unverified)`
          : `Verified ${verifiedCount} of ${addresses.length} addresses`,
        center: zone.center,
        mode: zone.mode,
        searchType: zone.search_type,
        metadata: {
          ...zone.metadata,
          verified_count: verifiedCount,
          unverified_count: unverifiedCount,
          total_addresses: addresses.length,
          returned_addresses: addressesToReturn.length,
          showing_only_verified: showOnlyVerified,
          processingTimeMs,
        },
        addresses: addressesToReturn,
      },
      200,
    );
  } catch (error) {
    console.error("Unexpected error in verifyAddresses:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred during verification",
      500,
    );
  }
});
