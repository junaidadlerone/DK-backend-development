import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts"; 
import { getUserPreferences } from "../_shared/preferences.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { enrichCurrency } from "../_shared/currency.ts";

/**
 * Get Campaign Launch Data Edge Function
 * Retrieves launch data for a campaign (public access)
 *
 * Business Rules:
 * - Public access (no authentication required)
 * - Returns launch_ready_campaign_data for the specified campaign
 * - Includes campaign PostGrid template IDs (front and back) with sizes
 * - Includes campaign business_data and offer_data
 * - Useful for socket connections and public integrations
 *
 * Request body:
 * {
 *   "campaign_id": "uuid"
 * }
 *
 * Response includes:
 * - launch_data: verified addresses and cost calculations
 * - campaign_templates: front_template_id, front_template_size, back_template_id, back_template_size
 * - business_data: campaign's business data from step 6
 * - offer_data: campaign's offer data from step 5
 */

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
    // Create Supabase client (service role for public access)
    const supabase = createSupabaseClient();

    // Parse request body
    let body: { campaign_id: string };
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

    const { campaign_id } = body;

    // Validate inputs
    if (!campaign_id) {
      return errorResponse(
        "INVALID_INPUT",
        "campaign_id is required",
        400
      );
    }

    // Attempt to get user for preferences (enriched data), but don't block if anonymous
    let userId = "";
    try {
        const user = getUserFromRequest(req);
        if (user) userId = user.userId;
    } catch {
        // Ignore auth errors for public endpoint
    }

    // Fetch user preferences (defaults if no user)
    const preferences = await getUserPreferences(supabase, userId);

    // Fetch launch data for the campaign
    const { data: launchData, error: fetchError } = await supabase
      .from("launch_ready_campaign_data")
      .select(`
        id,
        campaign_id,
        zone_id,
        csv_address_list_id,
        validated_addresses,
        final_cost,
        amount_per_postcard,
        verified_addresses,
        merge_variable,
        created_at,
        updated_at
      `)
      .eq("campaign_id", campaign_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching launch data:", fetchError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch launch data",
        500
      );
    }

    if (!launchData) {
      return errorResponse(
        "NOT_FOUND",
        "No launch data found for this campaign",
        404
      );
    }

    // Fetch is_editing and skip_verification status if csv_address_list_id exists
    let is_editing = false;
    let skip_verification = false;
    if (launchData.csv_address_list_id) {
      const { data: listData } = await supabase
        .from("campaign_csv_address_lists")
        .select("is_editing, skip_address_verification")
        .eq("id", launchData.csv_address_list_id)
        .maybeSingle();
      if (listData) {
        is_editing = listData.is_editing;
        skip_verification = listData.skip_address_verification === true;
      }
    }

    // Fetch campaign details (front_template_id, back_template_id, business_data, offer_data)
    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("front_template_id, back_template_id, business_data, offer_data, postgrid_tracker_id")
      .eq("id", campaign_id)
      .single();

    if (campaignError || !campaign) {
      console.error("Error fetching campaign:", campaignError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to fetch campaign details",
        500
      );
    }

    // Fetch front template size
    let frontTemplateSize = null;
    if (campaign.front_template_id) {
      const { data: frontTemplate } = await supabase
        .from("templates")
        .select("postcard_size, html")
        .eq("postgrid_template_id", campaign.front_template_id)
        .maybeSingle();

      frontTemplateSize = frontTemplate?.postcard_size || null;
    }

    // Fetch back template size
    let backTemplateSize = null;
    if (campaign.back_template_id) {
      const { data: backTemplate } = await supabase
        .from("templates")
        .select("postcard_size, html")
        .eq("postgrid_template_id", campaign.back_template_id)
        .maybeSingle();

      backTemplateSize = backTemplate?.postcard_size || null;
    }

    // Resolve template_bundle_id
    let template_bundle_id: string | null = null;
    if (campaign.front_template_id && campaign.back_template_id) {
      const templateIds = Array.from(new Set([campaign.front_template_id, campaign.back_template_id]));
      
      const { data: templateRows } = await supabase
        .from("templates")
        .select("id, postgrid_template_id")
        .in("postgrid_template_id", templateIds);

      if (templateRows && templateRows.length === templateIds.length) {
        const frontRow = (templateRows as { id: string, postgrid_template_id: string }[]).find(t => t.postgrid_template_id === campaign.front_template_id);
        const backRow  = (templateRows as { id: string, postgrid_template_id: string }[]).find(t => t.postgrid_template_id === campaign.back_template_id);

        if (frontRow && backRow) {
          const { data: bundle } = await supabase
            .from("template_bundles")
            .select("id")
            .eq("template_front_id", frontRow.id)
            .eq("template_back_id", backRow.id)
            .maybeSingle();

          template_bundle_id = bundle?.id ?? null;
          console.log(`[DEBUG] Resolved bundle ${template_bundle_id} from PostGrid templates ${campaign.front_template_id} / ${campaign.back_template_id}`);
        }
      } else {
        console.log(`[DEBUG] Could not find all template UUIDs for PostGrid IDs: ${JSON.stringify(templateIds)}. Found: ${JSON.stringify(templateRows)}`);
      }
    }

    const processingTimeMs = Date.now() - startTime;

    // Helper to safely parse float
    const finalCost = parseFloat(launchData.final_cost);
    const amountPerPostcard = parseFloat(launchData.amount_per_postcard);

    return successResponse({
      status: "success",
      launch_data: {
        id: launchData.id,
        campaign_id: launchData.campaign_id,
        campaign_target_type: campaign.campaign_target_type,
        zone_id: launchData.zone_id,
        csv_address_list_id: launchData.csv_address_list_id,
        is_editing,
        skip_verification,
        validated_addresses: launchData.validated_addresses,
        final_cost: finalCost,
        amount_per_postcard: amountPerPostcard,

        // Enriched Cost Display
        cost_display: {
            final_cost: enrichCurrency(finalCost, preferences.currency),
            per_postcard: enrichCurrency(amountPerPostcard, preferences.currency),
            currency_code: preferences.currency
        },

        verified_addresses: launchData.verified_addresses,
        merge_variable: launchData.merge_variable,
        created_at: launchData.created_at,
        updated_at: launchData.updated_at,

        // Enriched Timezones
        created_at_tz: enrichTimestamp(launchData.created_at, preferences.timezone),
        updated_at_tz: enrichTimestamp(launchData.updated_at, preferences.timezone)
      },
      campaign_templates: {
        template_bundle_id,
        front_template_id: campaign.front_template_id,
        front_template_size: frontTemplateSize,
        back_template_id: campaign.back_template_id,
        back_template_size: backTemplateSize,
        postgrid_tracker_id: campaign.postgrid_tracker_id
      },
      business_data: campaign.business_data,
      offer_data: campaign.offer_data,
      processingTimeMs
    });

  } catch (error) {
    console.error("Unexpected error in getCampaignLaunchData:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500
    );
  }
});
