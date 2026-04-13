import {
  corsResponse,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import {
  getUserOrganizationId,
  validateOrganizationAccess,
} from "../_shared/organization.ts";
import { AddressRow } from "../_shared/addressLists.ts";

/**
 * Launch Ready Campaign Edge Function
 * Verifies addresses for a campaign and calculates launch costs
 *
 * Business Rules:
 * - ADMIN and MARKETER only
 * - Campaign must have zone_id set
 * - Verifies all addresses in the zone using PostGrid
 * - Calculates final cost based on verified addresses
 * - Stores launch data in launch_ready_campaign_data table
 * - Updates campaign with launch_ready_id reference
 * - Organization-scoped
 *
 * Request body:
 * {
 *   "campaign_id": "uuid",
 *   "amount_per_postcard": 3.00 (optional, default: 3.00)
 * }
 *
 * Headers:
 * - x-postgrid-api-key (REQUIRED) - PostGrid API key for address verification
 */

// Use AddressRow from shared types
interface VerifiedAddress extends AddressRow {
  verified: boolean;
}

/**
 * Parses address string into components for PostGrid
 */
function parseAddress(formattedAddress: string) {
  const withoutCountry = formattedAddress.replace(
    /, (USA|US|United States)$/i,
    "",
  ).trim();
  const parts = withoutCountry.split(",").map((p) => p.trim());

  if (parts.length >= 3) {
    const line1 = parts[0];
    const city = parts[1];
    const stateZip = parts[2].split(" ");
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
    const line1 = parts[0];
    const cityStateZip = parts[1].split(" ");
    const city = cityStateZip.slice(0, -2).join(" ");
    const provinceOrState = cityStateZip[cityStateZip.length - 2];
    const postalOrZip = cityStateZip[cityStateZip.length - 1];

    return {
      line1,
      city,
      provinceOrState,
      postalOrZip,
      country: "US",
    };
  }

  return {
    line1: formattedAddress,
    city: "",
    provinceOrState: "",
    postalOrZip: "",
    country: "US",
  };
}

/**
 * Verify single address with PostGrid
 */
async function _verifyWithPostGrid(
  address: AddressRow,
  postgridApiKey: string,
): Promise<VerifiedAddress> {
  try {
    const addressStr = address.address || "";
    const addressComponents = parseAddress(addressStr);

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
          error: errorText,
        },
      );
      return {
        ...address,
        verified: false,
        verification_details: {
          error: `PostGrid API error: ${response.statusText}`,
          status_code: response.status,
        },
      };
    }

    const result = await response.json();
    const data = result.data;

    // Only status === 'verified' is considered verified
    const verified = data.status === "verified";
    const verifiedAddress =
      `${data.line1}, ${data.city}, ${data.provinceOrState} ${data.postalOrZip}`;

    return {
      ...address,
      address: verifiedAddress,
      verified,
      verification_details: {
        status: data.status,
        line1: data.line1,
        city: data.city,
        provinceOrState: data.provinceOrState,
        postalOrZip: data.postalOrZip,
      },
    };
  } catch (error) {
    console.error("Error verifying address with PostGrid:", error);
    return {
      ...address,
      verified: false,
      verification_details: {
        error: error instanceof Error ? error.message : "Unknown error",
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

    // Check if user is ADMIN or MARKETER using shared helper
    const hasAccess = await validateOrganizationAccess(
      supabase,
      organizationId,
      user.userId,
    );

    if (!hasAccess) {
      return errorResponse(
        "FORBIDDEN",
        "Only ADMIN and MARKETER users can launch campaigns",
        403,
      );
    }

    // PostGrid API key is not required as verification is skipped
    // const postgridApiKey = req.headers.get("x-postgrid-api-key");

    // Parse request body
    let body: { campaign_id: string; amount_per_postcard?: number };
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

    const { campaign_id, amount_per_postcard = 3.00 } = body;

    // Validate inputs
    if (!campaign_id) {
      return errorResponse(
        "INVALID_INPUT",
        "campaign_id is required",
        400,
      );
    }

    // Validate amount_per_postcard
    if (typeof amount_per_postcard !== "number" || amount_per_postcard <= 0) {
      return errorResponse(
        "INVALID_INPUT",
        "amount_per_postcard must be a positive number",
        400,
      );
    }

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, zone_id, csv_address_list_id, organization_id, campaign_name, business_data")
      .eq("id", campaign_id)
      .eq("organization_id", organizationId)
      .single();

    if (campaignError || !campaign) {
      console.error("Error fetching campaign:", campaignError);
      return errorResponse(
        "CAMPAIGN_NOT_FOUND",
        "Campaign not found in your organization",
        404,
      );
    }

    // Check if campaign has zone_id or csv_address_list_id
    if (!campaign.zone_id && !campaign.csv_address_list_id) {
      return errorResponse(
        "INVALID_CAMPAIGN",
        "Campaign does not have a location zone or address list set.",
        400,
      );
    }

    let allAddresses: AddressRow[] = [];
    let sourceId: string | null = null;
    let sourceType: "zone" | "list" = "zone";

    if (campaign.csv_address_list_id) {
      // Fetch from CSV Address List
      const { data: list, error: listError } = await supabase
        .from("campaign_csv_address_lists")
        .select("id, addresses")
        .eq("id", campaign.csv_address_list_id)
        .single();
      
      if (listError || !list) {
        return errorResponse("NOT_FOUND", "CSV Address List not found", 404);
      }
      allAddresses = list.addresses || [];
      sourceId = list.id;
      sourceType = "list";
    } else {
      // Fetch from traditional location Zone
      const { data: zone, error: zoneError } = await supabase
        .from("location_zones")
        .select("id, addresses")
        .eq("id", campaign.zone_id)
        .single();

      if (zoneError || !zone) {
        return errorResponse("ZONE_NOT_FOUND", "Zone not found", 404);
      }
      allAddresses = zone.addresses || [];
      sourceId = zone.id;
      sourceType = "zone";
    }

    if (allAddresses.length === 0) {
      return errorResponse(
        "INVALID_INPUT",
        "Zone has no addresses to verify",
        400,
      );
    }

    if (allAddresses.length > 10000) {
      return errorResponse(
        "INVALID_INPUT",
        "Cannot verify more than 10,000 addresses at once",
        400,
      );
    }

    console.log(
      `Processing ${allAddresses.length} addresses in ${sourceType} ${sourceId} for campaign ${campaign_id}`,
    );

    // Filter addresses: Skip Opt-out, Keep only already verified
    const onlyVerifiedAddresses: VerifiedAddress[] = [];
    let optOutCount = 0;

    for (const addr of allAddresses) {
      if (addr.status === "Opt-out") {
        optOutCount++;
        continue;
      }

      // Respect exclusion/deletion flags for CSV lists
      if (sourceType === "list") {
        if (addr.is_included === false || addr.is_deleted === true) {
          continue;
        }
      }

      // Check if address is already verified (from socket3 or verifyAddresses)
      // For CSV lists, if they were geocoded successfully, they have verified: true
      if (addr.verified === true || addr.is_valid === true) {
        onlyVerifiedAddresses.push(addr as VerifiedAddress);
      }
    }

    const validatedCount = onlyVerifiedAddresses.length;
    const finalCost = validatedCount * amount_per_postcard;

    console.log(
      `Processing complete: ${validatedCount} verified addresses found, ${optOutCount} opt-out, out of ${allAddresses.length} total`,
    );

    // Extract merge_variable from campaign's business_data if it exists
    const mergeVariable = campaign.business_data?.merge_variable || null;

    // Upsert to launch_ready_campaign_data table (update if exists, insert if not)
    const { data: launchData, error: upsertError } = await supabase
      .from("launch_ready_campaign_data")
      .upsert({
        campaign_id: campaign_id,
        zone_id: sourceType === "zone" ? sourceId : null,
        csv_address_list_id: sourceType === "list" ? sourceId : null,
        validated_addresses: validatedCount,
        final_cost: finalCost,
        amount_per_postcard: amount_per_postcard,
        verified_addresses: onlyVerifiedAddresses,
        merge_variable: mergeVariable,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "campaign_id",
      })
      .select()
      .single();

    if (upsertError || !launchData) {
      console.error("Error upserting launch data:", upsertError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to save launch data",
        500,
      );
    }

    // Update campaign with launch_ready_id
    const { error: updateError } = await supabase
      .from("campaigns")
      .update({
        launch_ready_id: launchData.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaign_id);

    if (updateError) {
      console.error(
        "Error updating campaign with launch_ready_id:",
        updateError,
      );
      // Don't fail the request, just log the error
    }

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      message:
        `Campaign launch data prepared: ${validatedCount} addresses verified`,
      validated_addresses: validatedCount,
      final_cost: parseFloat(finalCost.toFixed(2)),
      list_of_verified_addresses: onlyVerifiedAddresses,
      launch_ready_id: launchData.id,
      processingTimeMs,
    }, 201);
  } catch (error) {
    console.error("Unexpected error in launchReadyCampaign:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      500,
    );
  }
});
