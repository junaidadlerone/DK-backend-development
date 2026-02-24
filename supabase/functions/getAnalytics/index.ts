import {
  corsResponse,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { getUserPreferences, UserPreferences } from "../_shared/preferences.ts";
import { enrichCurrency } from "../_shared/currency.ts";

/**
 * Get Analytics Edge Function
 * Returns computed analytics based on type
 *
 * Business Rules:
 * - Organization-based (user must be in organization)
 * - Role-based access (ADMIN, MARKETER, TECHNICIAN)
 * - All analytics types ALWAYS compute fresh data (no caching)
 *
 * Request body:
 * {
 *   "type": "REFERRALS" | "TEMPLATES" | "CAMPAIGNS" | ... (extensible)
 * }
 *
 * Supported Types:
 * - REFERRALS: Returns referral analytics including campaign readiness (ALWAYS FRESH, NO CACHE)
 * - TEMPLATES: Returns template analytics by usage status (ALWAYS FRESH, NO CACHE)
 * - CAMPAIGNS: Returns campaign analytics including active campaigns and spending (ALWAYS FRESH, NO CACHE)
 * - DASHBOARD: Returns combined dashboard analytics with referrals and campaigns (ALWAYS FRESH, NO CACHE)
 * - TARGETING_ZONES: Returns targeting zones analytics including active zones and address metrics (ALWAYS FRESH, NO CACHE)
 * - ADDRESS_COLLECTION: Returns address collection analytics including total, validated, duplicates, and opt-outs (ALWAYS FRESH, NO CACHE)
 * - GLOBAL_EXCLUSIONS: Returns global exclusions analytics including total excluded, opt-outs, and manual entries (ALWAYS FRESH, NO CACHE)
 */

interface AnalyticsRequest {
  type: string;
}

interface ReferralsAnalyticsData {
  total_referrals: number;
  campaign_ready_referrals: number;
  campaign_published_referrals: number;
  avg_referrals_value: number;
  // Enriched
  avg_referrals_value_display?: any;
  overview: {
    currency: string;
    // Enriched
    currency_display?: any;
    total_referrals_breakdown: string;
    campaign_ready_referrals_breakdown: string;
    campaign_published_referrals_breakdown: string;
  };
}

interface TemplatesAnalyticsData {
  total_templates: number;
  active_templates: number;
  draft_templates: number;
  inactive_templates: number;
}

interface CampaignsAnalyticsData {
  active_campaigns: number;
  total_postcards_sent: number;
  total_spent: number;
  // Enriched
  total_spent_display?: any;
  total_leads_generated: number;
  avg_scan_rate: number;
  overview: {
    currency: string;
    // Enriched
    currency_display?: any;
    total_leads_generated_breakdown: string;
  };
}

interface DashboardAnalyticsData {
  total_referrals: number;
  active_campaigns: number;
  total_spent: number;
  // Enriched
  total_spent_display?: any;
  estimated_conversion_rate: number;
  average_scan_rate: number;
  overview: {
    currency: string;
    // Enriched
    currency_display?: any;
    total_referrals_breakdown: string;
    active_campaigns_breakdown: string;
    estimated_conversion_rate_breakdown: string;
  };
}

interface TargetingZonesAnalyticsData {
  active_targeting_zones: number;
  total_addresses_targetted: number;
  duplicate_supressions: number;
  average_radius: number;
  overview: {
    unit: string;
    symbol: string;
  };
}

interface AddressCollectionAnalyticsData {
  total_addresses: number;
  validated_addresses: number;
  duplicates: number;
  opt_outs: number;
}

interface GlobalExclusionsAnalyticsData {
  total_excluded: number;
  opt_outs: number;
  manual_entries: number;
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

    // Parse request body
    let body: AnalyticsRequest;
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

    const { type } = body;

    // Validate type
    if (!type || typeof type !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "type is required and must be a string",
        400,
      );
    }

    const analyticsType = type.toUpperCase();

    // Get today's date
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    // All analytics types always compute fresh data (skip cache)
    // No caching for any analytics type

    // Fetch user preferences for enrichment
    const preferences = await getUserPreferences(supabase, user.userId);

    // No cache or cache is stale - compute fresh analytics
    let analyticsData: any;

    switch (analyticsType) {
      case "REFERRALS":
        analyticsData = await computeReferralsAnalytics(
          supabase,
          organizationId,
          preferences,
        );
        break;

      case "TEMPLATES":
        analyticsData = await computeTemplatesAnalytics(
          supabase,
          organizationId,
        );
        break;

      case "CAMPAIGN": // Handle singular case if needed, or stick to plurals
      case "CAMPAIGNS":
        analyticsData = await computeCampaignsAnalytics(
          supabase,
          organizationId,
          preferences,
        );
        break;

      case "DASHBOARD":
        analyticsData = await computeDashboardAnalytics(
          supabase,
          organizationId,
          preferences,
        );
        break;

      case "TARGETING_ZONES":
        analyticsData = await computeTargetingZonesAnalytics(
          supabase,
          organizationId,
        );
        break;

      case "ADDRESS_COLLECTION":
        analyticsData = await computeAddressCollectionAnalytics(
          supabase,
          organizationId,
        );
        break;

      case "GLOBAL_EXCLUSIONS":
        analyticsData = await computeGlobalExclusionsAnalytics(
          supabase,
          organizationId,
        );
        break;

      // Future analytics types can be added here

      default:
        return errorResponse(
          "INVALID_TYPE",
          `Analytics type "${type}" is not supported. Supported types: REFERRALS, TEMPLATES, CAMPAIGNS, DASHBOARD, TARGETING_ZONES, ADDRESS_COLLECTION, GLOBAL_EXCLUSIONS`,
          400,
        );
    }

    // Save to cache (upsert - insert or update)
    const { error: upsertError } = await supabase
      .from("analytics")
      .upsert({
        organization_id: organizationId,
        analytics_type: analyticsType,
        analytics_date: today,
        data: analyticsData,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "organization_id,analytics_type,analytics_date",
      });

    if (upsertError) {
      console.error("Error caching analytics:", upsertError);
      // Don't fail the request, just log the error
    }

    return successResponse({
      status: "success",
      message: "Analytics computed successfully",
      cached: false,
      data: analyticsData,
    }, 200);
  } catch (error) {
    console.error("Unexpected error in getAnalytics:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});

/**
 * Compute Referrals Analytics
 */
async function computeReferralsAnalytics(
  supabase: any,
  organizationId: string,
  preferences: UserPreferences,
): Promise<ReferralsAnalyticsData> {
  // Get all referrals for the organization
  const { data: referrals, error: referralsError } = await supabase
    .from("referrals")
    .select(`
      id,
      campaign_id,
      job_details,
      status,
      created_at
    `)
    .eq("organization_id", organizationId);

  if (referralsError) {
    console.error("Error fetching referrals:", referralsError);
    throw new Error("Failed to fetch referrals");
  }

  const allReferrals = referrals || [];
  const totalReferrals = allReferrals.length;

  // Count referrals by status
  let campaignReadyCount = 0;
  let campaignPublishedCount = 0;

  for (const referral of allReferrals) {
    const statusName = referral.status?.name || referral.status;

    // Campaign ready referrals: status is "Ready"
    if (statusName === "Ready") {
      campaignReadyCount++;
    }

    // Campaign published referrals: status is "In Use"
    if (statusName === "In Use") {
      campaignPublishedCount++;
    }
  }

  // Calculate average referral value
  const referralValues: number[] = [];
  const currencies: string[] = [];

  for (const referral of allReferrals) {
    if (
      referral.job_details?.value &&
      typeof referral.job_details.value === "number"
    ) {
      referralValues.push(referral.job_details.value);
    }
    if (
      referral.job_details?.currency &&
      typeof referral.job_details.currency === "string"
    ) {
      currencies.push(referral.job_details.currency);
    }
  }

  const avgValue = referralValues.length > 0
    ? referralValues.reduce((sum, val) => sum + val, 0) / referralValues.length
    : 0;

  // Determine most common currency
  const currencyCount: Record<string, number> = {};
  currencies.forEach((curr) => {
    currencyCount[curr] = (currencyCount[curr] || 0) + 1;
  });

  const mostCommonCurrency = Object.keys(currencyCount).length > 0
    ? Object.keys(currencyCount).reduce((a, b) =>
      currencyCount[a] > currencyCount[b] ? a : b
    )
    : "USD";

  // Calculate "this week" breakdowns
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const referralsThisWeek =
    allReferrals.filter((r) => new Date(r.created_at) >= oneWeekAgo).length;

  // Count referrals by status created this week
  let campaignReadyThisWeek = 0;
  let campaignPublishedThisWeek = 0;

  for (const referral of allReferrals) {
    const referralDate = new Date(referral.created_at);
    if (referralDate >= oneWeekAgo) {
      const statusName = referral.status?.name || referral.status;

      // Campaign ready referrals: status is "Ready"
      if (statusName === "Ready") {
        campaignReadyThisWeek++;
      }

      // Campaign published referrals: status is "In Use"
      if (statusName === "In Use") {
        campaignPublishedThisWeek++;
      }
    }
  }

  const analyticsData: ReferralsAnalyticsData = {
    total_referrals: totalReferrals,
    campaign_ready_referrals: campaignReadyCount,
    campaign_published_referrals: campaignPublishedCount,
    avg_referrals_value: Math.round(avgValue * 100) / 100, // Round to 2 decimal places
    avg_referrals_value_display: enrichCurrency(
      Math.round(avgValue * 100) / 100,
      preferences.currency,
    ),
    overview: {
      currency: mostCommonCurrency,
      currency_display: {
        code: preferences.currency,
        symbol: enrichCurrency(0, preferences.currency).symbol,
        name: preferences.currency, // simplified
      },
      total_referrals_breakdown: `${referralsThisWeek} This week`,
      campaign_ready_referrals_breakdown: `${campaignReadyThisWeek} This week`,
      campaign_published_referrals_breakdown:
        `${campaignPublishedThisWeek} This week`,
    },
  };

  return analyticsData;
}

/**
 * Compute Templates Analytics (using Template Bundles)
 */
async function computeTemplatesAnalytics(
  supabase: any,
  organizationId: string,
): Promise<TemplatesAnalyticsData> {
  // Get all template bundles for the organization
  const { data: bundles, error: bundlesError } = await supabase
    .from("template_bundles")
    .select("id, template_front_id, template_back_id, is_universal, organization_id")
    .eq("organization_id", organizationId);

  if (bundlesError) {
    console.error("Error fetching template bundles:", bundlesError);
    throw new Error("Failed to fetch template bundles");
  }

  const allBundles = (bundles || []).filter((b: any) => !b.is_universal);

  // Fetch all templates referenced by bundles to check deleted/manual_edit status
  const templateIds = new Set<string>();
  for (const bundle of allBundles) {
    templateIds.add(bundle.template_front_id);
    templateIds.add(bundle.template_back_id);
  }

  const { data: templates, error: templatesError } = await supabase
    .from("templates")
    .select("id, postgrid_template_id, deleted, is_manual_edit")
    .in("id", Array.from(templateIds));

  if (templatesError) {
    console.error("Error fetching templates:", templatesError);
    throw new Error("Failed to fetch templates");
  }

  // Create maps for template lookup
  const templateMap = new Map<string, any>();
  (templates || []).forEach((t: any) => {
    templateMap.set(t.id, t);
  });

  // Filter out bundles where either template is deleted or manually edited
  const validBundles = allBundles.filter((bundle: any) => {
    const frontTemplate = templateMap.get(bundle.template_front_id);
    const backTemplate = templateMap.get(bundle.template_back_id);
    
    if (!frontTemplate || !backTemplate) return false;
    
    return !frontTemplate.deleted && 
           !frontTemplate.is_manual_edit && 
           !backTemplate.deleted && 
           !backTemplate.is_manual_edit;
  });

  const totalTemplates = validBundles.length;

  // Fetch all campaigns for the organization
  const { data: campaigns, error: campaignsError } = await supabase
    .from("campaigns")
    .select("id, front_template_id, back_template_id, status")
    .eq("organization_id", organizationId);

  if (campaignsError) {
    console.error("Error fetching campaigns:", campaignsError);
    throw new Error("Failed to fetch campaigns");
  }

  // Create a map of bundles to their campaigns
  const bundleCampaignsMap = new Map<string, Array<{ id: string; status: string }>>();

  for (const bundle of validBundles) {
    const frontTemplate = templateMap.get(bundle.template_front_id);
    const backTemplate = templateMap.get(bundle.template_back_id);

    if (!frontTemplate || !backTemplate) continue;

    const frontPostgridId = frontTemplate.postgrid_template_id;
    const backPostgridId = backTemplate.postgrid_template_id;

    // Find campaigns that use this bundle
    const matchingCampaigns = (campaigns || []).filter((campaign: any) => {
      return campaign.front_template_id === frontPostgridId &&
             campaign.back_template_id === backPostgridId;
    });

    if (matchingCampaigns.length > 0) {
      bundleCampaignsMap.set(bundle.id, matchingCampaigns.map((c: any) => ({
        id: c.id,
        status: c.status?.name || c.status
      })));
    }
  }

  // Count bundles by usage and campaign status
  let activeTemplates = 0;
  let draftTemplates = 0;
  let inactiveTemplates = 0;

  for (const bundle of validBundles) {
    const bundleCampaigns = bundleCampaignsMap.get(bundle.id) || [];

    if (bundleCampaigns.length > 0) {
      // Active: bundle is used in at least one campaign
      activeTemplates++;

      // Draft: check if any campaign has Draft status
      const hasDraftCampaign = bundleCampaigns.some((campaign) => 
        campaign.status === "Draft"
      );

      if (hasDraftCampaign) {
        draftTemplates++;
      }
    } else {
      // Inactive: bundle has never been used in any campaign
      inactiveTemplates++;
    }
  }

  const analyticsData: TemplatesAnalyticsData = {
    total_templates: totalTemplates,
    active_templates: activeTemplates,
    draft_templates: draftTemplates,
    inactive_templates: inactiveTemplates,
  };

  return analyticsData;
}

/**
 * Compute Campaigns Analytics
 */
async function computeCampaignsAnalytics(
  supabase: any,
  organizationId: string,
  preferences: UserPreferences,
): Promise<CampaignsAnalyticsData> {
  // Get all campaigns for the organization
  const { data: campaigns, error: campaignsError } = await supabase
    .from("campaigns")
    .select(
      "id, status, postcards_sent, leads_gen, scan_rate, created_at, updated_at",
    )
    .eq("organization_id", organizationId);

  if (campaignsError) {
    console.error("Error fetching campaigns:", campaignsError);
    throw new Error("Failed to fetch campaigns");
  }

  const allCampaigns = campaigns || [];

  // Calculate "this week" (7 days ago)
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // Count active campaigns
  let activeCampaigns = 0;
  let totalPostcardsSent = 0;
  let totalLeadsGenerated = 0;
  let totalLeadsGeneratedThisWeek = 0;
  let scanRateSum = 0;
  let scanRateCount = 0;

  for (const campaign of allCampaigns) {
    const statusName = campaign.status?.name || campaign.status;

    if (statusName === "Active") {
      activeCampaigns++;
    }

    // Sum up postcards_sent (handle null/undefined as 0)
    const postcardsSent = campaign.postcards_sent || 0;
    totalPostcardsSent += postcardsSent;

    // Sum up leads_gen (handle null/undefined as 0)
    const leadsGen = campaign.leads_gen || 0;
    totalLeadsGenerated += leadsGen;

    // Check if campaign was updated this week (leads are typically updated via updated_at)
    const campaignUpdatedAt = new Date(campaign.updated_at);
    if (campaignUpdatedAt >= oneWeekAgo && leadsGen > 0) {
      // Assume all leads for campaigns updated this week were generated this week
      totalLeadsGeneratedThisWeek += leadsGen;
    }

    // Sum up scan_rate for average calculation (only if not null/undefined)
    if (campaign.scan_rate !== null && campaign.scan_rate !== undefined) {
      scanRateSum += campaign.scan_rate;
      scanRateCount++;
    }
  }

  // Calculate total spent (postcards_sent * 3)
  const totalSpent = totalPostcardsSent * 3;

  // Calculate average scan rate
  const avgScanRate = scanRateCount > 0 ? scanRateSum / scanRateCount : 0;

  const analyticsData: CampaignsAnalyticsData = {
    active_campaigns: activeCampaigns,
    total_postcards_sent: totalPostcardsSent,
    total_spent: totalSpent,
    total_leads_generated: totalLeadsGenerated,
    avg_scan_rate: Math.round(avgScanRate * 100) / 100, // Round to 2 decimal places
    overview: {
      currency: "USD",
      currency_display: {
        code: preferences.currency,
        symbol: enrichCurrency(0, preferences.currency).symbol,
      },
      total_leads_generated_breakdown:
        `${totalLeadsGeneratedThisWeek} This week`,
    },
  };

  // Add enriched total spent
  (analyticsData as any).total_spent_display = enrichCurrency(
    totalSpent,
    preferences.currency,
  );

  return analyticsData;

  return analyticsData;
}

/**
 * Compute Dashboard Analytics
 */
async function computeDashboardAnalytics(
  supabase: any,
  organizationId: string,
  preferences: UserPreferences,
): Promise<DashboardAnalyticsData> {
  // Get all referrals for the organization
  const { data: referrals, error: referralsError } = await supabase
    .from("referrals")
    .select("id, created_at")
    .eq("organization_id", organizationId);

  if (referralsError) {
    console.error("Error fetching referrals:", referralsError);
    throw new Error("Failed to fetch referrals");
  }

  const allReferrals = referrals || [];
  const totalReferrals = allReferrals.length;

  // Calculate referrals this week
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const referralsThisWeek =
    allReferrals.filter((r) => new Date(r.created_at) >= oneWeekAgo).length;

  // Get all campaigns for the organization
  const { data: campaigns, error: campaignsError } = await supabase
    .from("campaigns")
    .select(
      "id, status, postcards_sent, leads_gen, scan_rate, created_at, updated_at",
    )
    .eq("organization_id", organizationId);

  if (campaignsError) {
    console.error("Error fetching campaigns:", campaignsError);
    throw new Error("Failed to fetch campaigns");
  }

  const allCampaigns = campaigns || [];

  // Count active campaigns and calculate total spent
  let activeCampaigns = 0;
  let totalPostcardsSent = 0;
  let activeCampaignsThisWeek = 0;
  let totalLeadsGen = 0;
  let scanRateSum = 0;
  let scanRateCount = 0;
  let totalPostcardsSentThisWeek = 0;
  let totalLeadsGenThisWeek = 0;

  for (const campaign of allCampaigns) {
    const statusName = campaign.status?.name || campaign.status;

    if (statusName === "Active") {
      activeCampaigns++;

      // Check if this campaign became active this week
      const campaignDate = new Date(campaign.created_at);
      if (campaignDate >= oneWeekAgo) {
        activeCampaignsThisWeek++;
      }
    }

    // Sum up postcards_sent (handle null/undefined as 0)
    const postcardsSent = campaign.postcards_sent || 0;
    totalPostcardsSent += postcardsSent;

    // Sum up leads_gen (handle null/undefined as 0)
    const leadsGen = campaign.leads_gen || 0;
    totalLeadsGen += leadsGen;

    // Sum up scan_rate for average calculation (only if not null/undefined)
    if (campaign.scan_rate !== null && campaign.scan_rate !== undefined) {
      scanRateSum += campaign.scan_rate;
      scanRateCount++;
    }

    // Check if campaign was updated this week for conversion rate breakdown
    const campaignUpdatedAt = new Date(campaign.updated_at);
    if (campaignUpdatedAt >= oneWeekAgo) {
      totalPostcardsSentThisWeek += postcardsSent;
      totalLeadsGenThisWeek += leadsGen;
    }
  }

  // Calculate total spent (postcards_sent * 3)
  const totalSpent = totalPostcardsSent * 3;

  // Calculate average scan rate
  const averageScanRate = scanRateCount > 0 ? scanRateSum / scanRateCount : 0;

  // Calculate estimated conversion rate (leads_gen / postcards_sent * 100)
  // Assuming everyone who scans (leads_gen) will become a lead (100% conversion from scan to lead)
  const estimatedConversionRate = totalPostcardsSent > 0
    ? (totalLeadsGen / totalPostcardsSent) * 100
    : 0;

  // Calculate estimated conversion rate for this week
  const estimatedConversionRateThisWeek = totalPostcardsSentThisWeek > 0
    ? (totalLeadsGenThisWeek / totalPostcardsSentThisWeek) * 100
    : 0;

  const analyticsData: DashboardAnalyticsData = {
    total_referrals: totalReferrals,
    active_campaigns: activeCampaigns,
    total_spent: totalSpent,
    estimated_conversion_rate: Math.round(estimatedConversionRate * 100) / 100, // Round to 2 decimal places
    average_scan_rate: Math.round(averageScanRate * 100) / 100, // Round to 2 decimal places
    overview: {
      currency: "USD",
      currency_display: {
        code: preferences.currency,
        symbol: enrichCurrency(0, preferences.currency).symbol,
      },
      total_referrals_breakdown: `${referralsThisWeek} This week`,
      active_campaigns_breakdown: `${activeCampaignsThisWeek} This week`,
      estimated_conversion_rate_breakdown: `${
        Math.round(estimatedConversionRateThisWeek * 100) / 100
      }% This week`,
    },
  };

  // Add enriched total spent
  (analyticsData as any).total_spent_display = enrichCurrency(
    totalSpent,
    preferences.currency,
  );

  return analyticsData;
}

/**
 * Compute Targeting Zones Analytics
 */
async function computeTargetingZonesAnalytics(
  supabase: any,
  organizationId: string,
): Promise<TargetingZonesAnalyticsData> {
  // Get all location_zones for the organization
  const { data: locationZones, error: zonesError } = await supabase
    .from("location_zones")
    .select("id, campaign_id, addresses, center, manual_search")
    .eq("organization_id", organizationId);

  if (zonesError) {
    console.error("Error fetching location zones:", zonesError);
    throw new Error("Failed to fetch location zones");
  }

  const allZones = locationZones || [];

  // Count active targeting zones (zones with Active campaigns)
  let activeTargetingZones = 0;
  let totalAddressesTargetted = 0;
  let radiusSum = 0;
  let radiusCount = 0;

  // Map to track all addresses for duplicate detection
  const addressesMap = new Map<string, number>();

  for (const zone of allZones) {
    // Count active zones (zones with ANY campaign attached OR manual_search is true)
    if (zone.campaign_id !== null || zone.manual_search === true) {
      activeTargetingZones++;
    }

    // Only proceed to count addresses if the zone is active
    if (zone.campaign_id !== null || zone.manual_search === true) {
      // Count total addresses with status "verified" or "Valid"
      if (Array.isArray(zone.addresses)) {
        for (const address of zone.addresses) {
          // Only count addresses with status "verified" or "Valid"
          if (
            address && typeof address === "object" &&
            (address.status === "verified" || address.status === "Valid")
          ) {
            totalAddressesTargetted++;
          }

          // Track addresses for duplicate detection
          const addressKey = JSON.stringify(address);
          const currentCount = addressesMap.get(addressKey) || 0;
          addressesMap.set(addressKey, currentCount + 1);
        }
      }

      // Calculate average radius (center.radius)
      if (
        zone.center && typeof zone.center === "object" &&
        zone.center.radius !== undefined
      ) {
        radiusSum += zone.center.radius;
        radiusCount++;
      }
    }
  }

  // Calculate duplicate suppressions (addresses that appear more than once)
  let duplicateSupressions = 0;
  for (const [_, count] of addressesMap.entries()) {
    if (count > 1) {
      // Count extra occurrences (count - 1) as duplicates
      duplicateSupressions += count - 1;
    }
  }

  // Calculate average radius
  const averageRadius = radiusCount > 0 ? radiusSum / radiusCount : 0;

  const analyticsData: TargetingZonesAnalyticsData = {
    active_targeting_zones: activeTargetingZones,
    total_addresses_targetted: totalAddressesTargetted,
    duplicate_supressions: duplicateSupressions,
    average_radius: averageRadius,
    overview: {
      unit: "miles",
      symbol: "mi",
    },
  };

  return analyticsData;
}

/**
 * Compute Address Collection Analytics
 */
async function computeAddressCollectionAnalytics(
  supabase: any,
  organizationId: string,
): Promise<AddressCollectionAnalyticsData> {
  // Get all location_zones for the organization
  const { data: locationZones, error: zonesError } = await supabase
    .from("location_zones")
    .select("id, addresses, campaign_id, manual_search")
    .eq("organization_id", organizationId);

  if (zonesError) {
    console.error("Error fetching location zones:", zonesError);
    throw new Error("Failed to fetch location zones");
  }

  const allZones = locationZones || [];

  // Variables to track metrics
  let totalAddresses = 0;
  let validatedAddresses = 0;
  let optOuts = 0;

  // Map to precisely deduplicate by lat/long (just like getAllAddresses)
  const addressMap = new Map<string, any>();
  let duplicates = 0;

  for (const zone of allZones) {
    // Only process addresses if the zone is active (campaign_id not null)
    if (zone.campaign_id !== null && Array.isArray(zone.addresses)) {
      
      // Order zones by created_at desc would be ideal here if available, 
      // but Since getAnalytics doesn't query created_at for zones, we'll dedupe as they come
      for (const address of zone.addresses) {
        if (address && typeof address === "object") {
          const status = address.status || "Unverified";

          // Exclude "Unverified" exactly like getAllAddresses does when showOnlyExclusions=false
          if (status !== "Unverified") {
            
            // Ensure we have lat and long to deduplicate by
            if (address.lat !== undefined && address.long !== undefined) {
              const key = `${Number(address.lat).toFixed(6)},${Number(address.long).toFixed(6)}`;
              
              if (!addressMap.has(key)) {
                addressMap.set(key, address);
              } else {
                duplicates++; // It's a duplicate of an existing coordinate
              }
            } else {
              // Fallback if somehow lat/long are missing, still count them but don't deduplicate
              addressMap.set(Math.random().toString(), address);
            }
          }
        }
      }
    }
  }

  // Now calculate metrics off the deduplicated list
  const deduplicatedAddresses = Array.from(addressMap.values());
  totalAddresses = deduplicatedAddresses.length;

  for (const addr of deduplicatedAddresses) {
    const status = addr.status;
    if (status === "Valid" || status === "verified") {
      validatedAddresses++;
    } else if (status === "Opt-out") {
      optOuts++;
    }
  }

  const analyticsData: AddressCollectionAnalyticsData = {
    total_addresses: totalAddresses,
    validated_addresses: validatedAddresses,
    duplicates: duplicates,
    opt_outs: optOuts,
  };

  return analyticsData;
}

/**
 * Compute Global Exclusions Analytics
 */
async function computeGlobalExclusionsAnalytics(
  supabase: any,
  organizationId: string,
): Promise<GlobalExclusionsAnalyticsData> {
  // Get all location_zones for the organization
  const { data: locationZones, error: zonesError } = await supabase
    .from("location_zones")
    .select("id, addresses")
    .eq("organization_id", organizationId);

  if (zonesError) {
    console.error("Error fetching location zones:", zonesError);
    throw new Error("Failed to fetch location zones");
  }

  const allZones = locationZones || [];

  // Variables to track metrics
  let totalExcluded = 0;
  let optOuts = 0;
  let manualEntries = 0;

  // Map to precisely deduplicate exclusions by lat/long
  const addressMap = new Map<string, any>();

  for (const zone of allZones) {
    if (Array.isArray(zone.addresses)) {
      for (const address of zone.addresses) {
        if (address && typeof address === "object") {
          
          // Count manual entries exactly as before (leave as is)
          if (address.manual_entry === true) {
            manualEntries++;
          }

          const status = address.status || "Unverified";

          // For exclusions, we DONT want Valid and we DONT want Unverified. (Matches showOnlyExclusions=true)
          if (status !== "Valid" && status !== "Unverified") {

            // Ensure we have lat and long to deduplicate by
            if (address.lat !== undefined && address.long !== undefined) {
              const key = `${Number(address.lat).toFixed(6)},${Number(address.long).toFixed(6)}`;
              
              if (!addressMap.has(key)) {
                addressMap.set(key, address);
              }
            } else {
              // Fallback if somehow lat/long are missing, still count them but don't deduplicate
              addressMap.set(Math.random().toString(), address);
            }
          }
        }
      }
    }
  }

  // Calculate metrics off the deduplicated exclusions list
  const deduplicatedExclusions = Array.from(addressMap.values());
  totalExcluded = deduplicatedExclusions.length;

  for (const addr of deduplicatedExclusions) {
    if (addr.status === "Opt-out") {
      optOuts++;
    }
  }

  const analyticsData: GlobalExclusionsAnalyticsData = {
    total_excluded: totalExcluded,
    opt_outs: optOuts,
    manual_entries: manualEntries,
  };

  return analyticsData;
}
