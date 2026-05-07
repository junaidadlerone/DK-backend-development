import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { getUserPreferences, UserPreferences } from "../_shared/preferences.ts";
import { enrichCurrency } from "../_shared/currency.ts";
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

interface CampaignData {
  id: string;
  postgrid_tracker_id?: string;
  postcards_sent?: number;
  leads_gen?: number;
  scan_rate?: number;
  referral_id?: string;
  zone_id?: string;
  front_template_id?: string;
  back_template_id?: string;
  paper_type?: string;
  created_at: string;
  updated_at: string;
}

function campaignCostPerPostcard(campaign: CampaignData): number {
  return campaign.paper_type === 'premium' ? 3.50 : 3.00;
}

/**
 * Get Analytics Page Data Edge Function
 * Returns detailed analytics data with comprehensive metrics
 *
 * Business Rules:
 * - Organization-based (user must be in organization)
 * - Supports optional campaign filtering and date range filtering
 * - Computes fresh data on every call but caches for fallback
 * - Uses PostGrid Tracker API for QR scan tracking data (aggregated totals)
 *
 * Request body:
 * {
 *   "type": "OVERVIEW" (mandatory),
 *   "selected_campaign_id": UUID (optional),
 *   "selected_start_date": "YYYY-MM-DD" (optional, requires selected_end_date),
 *   "selected_end_date": "YYYY-MM-DD" (optional, requires selected_start_date)
 * }
 */

interface AnalyticsPageRequest {
  type: string;
  selected_campaign_id?: string;
  selected_start_date?: string;
  selected_end_date?: string;
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
    let body: AnalyticsPageRequest;
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

    const { type, selected_campaign_id, selected_start_date, selected_end_date } = body;

    // Validate type
    if (!type || typeof type !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "type is required and must be a string",
        400
      );
    }

    const analyticsType = type.toUpperCase();
    if (analyticsType !== "OVERVIEW" && analyticsType !== "CAMPAIGN_PERFORMANCE" && analyticsType !== "ROI") {
      return errorResponse(
        "INVALID_TYPE",
        'Supported types: "OVERVIEW", "CAMPAIGN_PERFORMANCE", "ROI"',
        400
      );
    }

    // Validate date range
    if ((selected_start_date && !selected_end_date) || (!selected_start_date && selected_end_date)) {
      return errorResponse(
        "INVALID_INPUT",
        "Both selected_start_date and selected_end_date must be provided together",
        400
      );
    }

    // Fetch user preferences for enrichment
    const preferences = await getUserPreferences(supabase, user.userId);

    // Try to compute fresh analytics
    let analyticsData: Record<string, unknown> = {};

    try {
      if (analyticsType === "OVERVIEW") {
        analyticsData = await computeOverviewAnalytics(
          supabase,
          organizationId,
          preferences,
          selected_campaign_id,
          selected_start_date,
          selected_end_date
        );
      } else if (analyticsType === "CAMPAIGN_PERFORMANCE") {
        analyticsData = await computeCampaignPerformanceAnalytics(
          supabase,
          organizationId,
          preferences,
          selected_campaign_id,
          selected_start_date,
          selected_end_date
        );
      } else if (analyticsType === "ROI") {
        analyticsData = await computeROIAnalytics(
          supabase,
          organizationId,
          preferences,
          selected_campaign_id,
          selected_start_date,
          selected_end_date
        );
      }

      // Cache the result
      await cacheAnalytics(
        supabase,
        organizationId,
        analyticsType,
        selected_campaign_id,
        selected_start_date,
        selected_end_date,
        analyticsData
      );

    } catch (computeError) {
      console.error("Error computing analytics:", computeError);

      // Try to fallback to cache
      const cachedData = await getCachedAnalytics(
        supabase,
        organizationId,
        type.toUpperCase(),
        selected_campaign_id,
        selected_start_date,
        selected_end_date
      );

      if (cachedData) {
        console.log("Returning cached data due to computation error");
        return successResponse({
          status: "success",
          message: "Analytics retrieved from cache (computation failed)",
          cached: true,
          data: {
            analytics_data: cachedData
          }
        }, 200);
      }

      // No cache available, return error
      throw computeError;
    }

    return successResponse({
      status: "success",
      message: "Analytics computed successfully",
      cached: false,
      data: {
        analytics_data: analyticsData
      }
    }, 200);

  } catch (error: unknown) {
    console.error("Unexpected error in getAnalyticsPageData:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${(error as Error)?.message || "Unknown error"}`,
      500
    );
  }
});

/**
 * Compute Overview Analytics
 */
async function computeOverviewAnalytics(
  supabase: SupabaseClient,
  organizationId: string,
  _preferences: UserPreferences,
  campaignId?: string,
  startDate?: string,
  endDate?: string
): Promise<Record<string, unknown>> {

  // Build campaign query
  let campaignQuery = supabase
    .from("campaigns")
    .select("id, postgrid_tracker_id, postcards_sent, leads_gen, scan_rate, referral_id, paper_type, created_at, updated_at")
    .eq("organization_id", organizationId);

  if (campaignId) {
    campaignQuery = campaignQuery.eq("id", campaignId);
  }

  const { data: campaigns, error: campaignsError } = await campaignQuery;

  if (campaignsError) {
    console.error("Error fetching campaigns:", campaignsError);
    throw new Error(`Failed to fetch campaigns: ${campaignsError.message}`);
  }

  const allCampaigns = (campaigns as unknown as CampaignData[]) || [];
  const totalCampaigns = allCampaigns.length;

  // Calculate date boundaries
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const _filterStartDate = startDate ? new Date(startDate) : null;
  const _filterEndDate = endDate ? new Date(endDate) : null;

  let totalPostcardsSent = 0;
  let totalQrScans = 0;
  let totalQrScansToday = 0;
  let totalQrScansThisWeek = 0;
  let totalQrScansThisMonth = 0;
  let totalQrScansInRange = 0;

  // Track campaigns with leads for top performers
  const campaignsWithLeads: Array<{campaign: CampaignData, leads: number, roi: number}> = [];
  let overviewTotalCost = 0;

  for (const campaign of allCampaigns) {
    totalPostcardsSent += campaign.postcards_sent || 0;

    // Use leads_gen from database (synced via syncPostGridAnalytics)
    const campaignLeads = campaign.leads_gen || 0;
    let leadsToday = 0;
    let leadsThisWeek = 0;
    let leadsThisMonth = 0;
    let leadsInRange = 0;

    // For historical breakdowns without real-time time-series,
    // we use updated_at as a proxy for recent activity.
    const updatedAt = new Date(campaign.updated_at);

    if (updatedAt >= todayStart) {
      leadsToday = campaignLeads;
    }

    if (updatedAt >= weekStart) {
      leadsThisWeek = campaignLeads;
    }

    if (updatedAt >= monthStart) {
      leadsThisMonth = campaignLeads;
    }

    if (_filterStartDate && _filterEndDate && updatedAt >= _filterStartDate && updatedAt <= _filterEndDate) {
      leadsInRange = campaignLeads;
    }

    totalQrScans += campaignLeads;
    totalQrScansToday += leadsToday;
    totalQrScansThisWeek += leadsThisWeek;
    totalQrScansThisMonth += leadsThisMonth;
    totalQrScansInRange += leadsInRange;

    // Calculate ROI for this campaign
    const costPerPostcard = campaignCostPerPostcard(campaign);
    const revenuePerLead = 1000;
    const totalCost = (campaign.postcards_sent || 0) * costPerPostcard;
    overviewTotalCost += totalCost;
    const totalRevenue = campaignLeads * revenuePerLead;
    const roi = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0;

    if (campaignLeads > 0) {
      campaignsWithLeads.push({
        campaign,
        leads: campaignLeads,
        roi
      });
    }
  }

  // Calculate total estimated average ROI
  const totalCost = overviewTotalCost;
  const totalRevenue = totalQrScans * 10;
  const totalEstimatedAverageROI = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0;

  // Get top performing campaigns (by leads, then by ROI)
  const topPerformingCampaigns = campaignsWithLeads
    .sort((a, b) => {
      if (b.leads !== a.leads) return b.leads - a.leads;
      return b.roi - a.roi;
    })
    .slice(0, 10)
    .map(item => item.campaign);

  // Get top referrals by leads (only for organization view, not single campaign)
  let topReferralsByLeads: Record<string, unknown>[] = [];

  if (!campaignId && topPerformingCampaigns.length > 0) {
    const topCampaignIds = topPerformingCampaigns
      .map(c => c.id)
      .filter(id => id); // Remove nulls

    if (topCampaignIds.length > 0) {
      const { data: referrals, error: referralsError } = await supabase
        .from("referrals")
        .select("*")
        .in("campaign_id", topCampaignIds)
        .limit(10);

      if (!referralsError && referrals) {
        topReferralsByLeads = referrals as Record<string, unknown>[];
      }
    }
  }

  // Get geographic distribution (addresses from location_zones)
  const { data: locationZones, error: zonesError } = await supabase
    .from("location_zones")
    .select("id, addresses, campaign_id")
    .eq("organization_id", organizationId);

  const reachAddresses: Record<string, unknown>[] = [];

  if (!zonesError && locationZones) {
    for (const _zone of (locationZones as unknown as Array<{campaign_id: string, addresses: unknown}>)) {
      if (!campaignId || _zone.campaign_id === campaignId) {
        if (Array.isArray(_zone.addresses)) {
          // Filter addresses with verified/Valid status
          const validAddresses = (_zone.addresses as unknown[]).filter((addr: any) =>
            addr && typeof addr === 'object' &&
            (addr.status === 'verified' || addr.status === 'Valid')
          );
          reachAddresses.push(...validAddresses);
        }
      }
    }
  }

  // Build response based on whether it's single campaign or organization view
  const analyticsData: any = {
    total_campaigns: totalCampaigns,
    total_postcards_sent: totalPostcardsSent,
    total_qr_scans_all_time: totalQrScans,
    total_estimated_leads_generated: totalQrScans, // Assuming 100% conversion
    total_estimated_average_roi: Math.round(totalEstimatedAverageROI * 100) / 100,
    geographic_distribution: {
      reach: reachAddresses,
      qr_scans: {
        total: totalQrScans,
        overview: `${totalQrScansThisWeek} This week`
      }
    },
    campaign_activity_overtime: {
      daily: {
        total: totalQrScansToday,
        overview: `${totalQrScansToday} Today`
      },
      weekly: {
        total: totalQrScansThisWeek,
        overview: `${totalQrScansThisWeek} This week`
      },
      monthly: {
        total: totalQrScansThisMonth,
        overview: `${totalQrScansThisMonth} This month`
      }
    }
  };

  // Add custom date range if provided
  if (_filterStartDate && _filterEndDate) {
    analyticsData.campaign_activity_overtime.custom_range = {
      total: totalQrScansInRange,
      overview: `${totalQrScansInRange} in selected range`,
      start_date: startDate,
      end_date: endDate
    };
  }

  // Only include these fields for organization view (not single campaign)
  if (!campaignId) {
    analyticsData.top_performing_campaigns = topPerformingCampaigns;
    analyticsData.top_referrals_by_leads = topReferralsByLeads;
  }

  return analyticsData;
}

/**
 * Cache analytics data
 */
async function cacheAnalytics(
  supabase: SupabaseClient,
  organizationId: string,
  analyticsType: string,
  campaignId?: string,
  startDate?: string,
  endDate?: string,
  data?: unknown
): Promise<void> {
  try {
    const { error: upsertError } = await supabase
      .from("detailed_analytics")
      .upsert({
        organization_id: organizationId,
        analytics_type: analyticsType,
        campaign_id: campaignId || null,
        start_date: startDate || null,
        end_date: endDate || null,
        data: data,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "organization_id,analytics_type,campaign_id,start_date,end_date"
      });

    if (upsertError) {
      console.error("Error caching analytics:", upsertError);
    }
  } catch (error) {
    console.error("Error in cacheAnalytics:", error);
  }
}

/**
 * Get cached analytics data
 */
async function getCachedAnalytics(
  supabase: SupabaseClient,
  organizationId: string,
  analyticsType: string,
  campaignId?: string,
  startDate?: string,
  endDate?: string
): Promise<unknown | null> {
  try {
    let query = supabase
      .from("detailed_analytics")
      .select("data")
      .eq("organization_id", organizationId)
      .eq("analytics_type", analyticsType);

    if (campaignId) {
      query = query.eq("campaign_id", campaignId);
    } else {
      query = query.is("campaign_id", null);
    }

    if (startDate && endDate) {
      query = query.eq("start_date", startDate).eq("end_date", endDate);
    } else {
      query = query.is("start_date", null).is("end_date", null);
    }

    const { data, error } = await query
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

  return (data as { data: any }).data;
  } catch (error) {
    console.error("Error getting cached analytics:", error);
    return null;
  }
}

/**
 * Compute Campaign Performance Analytics
 */
async function computeCampaignPerformanceAnalytics(
  supabase: SupabaseClient,
  organizationId: string,
  _preferences: UserPreferences,
  campaignId?: string,
  startDate?: string,
  endDate?: string
): Promise<Record<string, unknown>> {

  // Build campaign query
  let campaignQuery = supabase
    .from("campaigns")
    .select("id, postgrid_tracker_id, postcards_sent, leads_gen, scan_rate, zone_id, front_template_id, back_template_id, paper_type, created_at, updated_at")
    .eq("organization_id", organizationId);

  if (campaignId) {
    campaignQuery = campaignQuery.eq("id", campaignId);
  }

  const { data: campaigns, error: campaignsError } = await campaignQuery;

  if (campaignsError) {
    console.error("Error fetching campaigns:", campaignsError);
    throw new Error("Failed to fetch campaigns");
  }

  const allCampaigns = campaigns || [];

  // Calculate date boundaries
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const _filterStartDate = startDate ? new Date(startDate) : null;
  const _filterEndDate = endDate ? new Date(endDate) : null;

  // Calculate overall metrics
  let totalPostcardsSent = 0;
  let totalQrScans = 0;
  let totalPostcardsSentToday = 0;
  let totalQrScansToday = 0;
  let totalPostcardsSentWeek = 0;
  let totalQrScansWeek = 0;
  let totalPostcardsSentMonth = 0;
  let totalQrScansMonth = 0;

  // Track zone_ids for average distance calculation
  const zoneIds: string[] = [];

  for (const campaign of allCampaigns) {
    const postcardsSent = campaign.postcards_sent || 0;
    totalPostcardsSent += postcardsSent;

    if (campaign.zone_id) {
      zoneIds.push(campaign.zone_id);
    }

    // Use leads_gen from database
    const campaignLeads = campaign.leads_gen || 0;
    let leadsToday = 0;
    let leadsWeek = 0;
    let leadsMonth = 0;

    // Use updated_at as proxy for recent activity
    const updatedAt = new Date(campaign.updated_at);
    if (updatedAt >= todayStart) leadsToday = campaignLeads;
    if (updatedAt >= weekStart) leadsWeek = campaignLeads;
    if (updatedAt >= monthStart) leadsMonth = campaignLeads;

    totalQrScans += campaignLeads;
    totalQrScansToday += leadsToday;
    totalQrScansWeek += leadsWeek;
    totalQrScansMonth += leadsMonth;

    // For time-based postcards_sent, use created_at as proxy
    const createdAt = new Date(campaign.created_at);
    if (createdAt >= todayStart) totalPostcardsSentToday += postcardsSent;
    if (createdAt >= weekStart) totalPostcardsSentWeek += postcardsSent;
    if (createdAt >= monthStart) totalPostcardsSentMonth += postcardsSent;
  }

  // Calculate total conversion rate
  const totalConversionRate = totalPostcardsSent > 0
    ? (totalQrScans / totalPostcardsSent) * 100
    : 0;

  // Calculate average distance from location_zones
  let totalAverageDistance = 0;
  if (zoneIds.length > 0) {
    const { data: zones, error: zonesError } = await supabase
      .from("location_zones")
      .select("center")
      .in("id", zoneIds);

    if (!zonesError && zones) {
      let radiusSum = 0;
      let radiusCount = 0;

      for (const zone of zones) {
        if (zone.center && typeof zone.center === 'object' && zone.center.radius !== undefined) {
          radiusSum += zone.center.radius;
          radiusCount++;
        }
      }

      totalAverageDistance = radiusCount > 0 ? radiusSum / radiusCount : 0;
    }
  }

  // Calculate delivery vs response (for this month)
  const deliveryVsResponsePercentage = totalPostcardsSentMonth > 0
    ? (totalQrScansMonth / totalPostcardsSentMonth) * 100
    : 0;

  // Calculate template performance
  const templatePerformance = await calculateTemplatePerformance(
    supabase,
    organizationId,
    allCampaigns
  );

  const analyticsData: Record<string, unknown> = {
    total_postcards_sent: totalPostcardsSent,
    total_qr_scans: totalQrScans,
    total_conversion_rate: Math.round(totalConversionRate * 100) / 100,
    cost_per_lead: 3,
    cost_per_lead_display: enrichCurrency(3, _preferences.currency),
    total_average_distance: Math.round(totalAverageDistance * 100) / 100,
    overview: {
      unit: "miles",
      symbol: "mi"
    },
    engagement_overtime: {
      daily: {
        total_postcards_sent: totalPostcardsSentToday,
        total_qr_scans: totalQrScansToday,
        overview: `${totalQrScansToday} Today`
      },
      weekly: {
        total_postcards_sent: totalPostcardsSentWeek,
        total_qr_scans: totalQrScansWeek,
        overview: `${totalQrScansWeek} This week`
      },
      monthly: {
        total_postcards_sent: totalPostcardsSentMonth,
        total_qr_scans: totalQrScansMonth,
        overview: `${totalQrScansMonth} This month`
      }
    },
    delivery_vs_response: {
      delivery: totalPostcardsSentMonth,
      response: totalQrScansMonth,
      percentage: Math.round(deliveryVsResponsePercentage * 100) / 100
    },
    template_performance: templatePerformance
  };

  return analyticsData;
}

/**
 * Calculate Template Bundle Performance
 * Groups campaigns by their template bundle (front+back pair) instead of
 * individual templates, so each entry in template_performance represents
 * one bundle. The `template` field contains the bundle object.
 */
async function calculateTemplatePerformance(
  supabase: SupabaseClient,
  organizationId: string,
  campaigns: CampaignData[]
): Promise<Record<string, unknown>[]> {

  if (campaigns.length === 0) return [];

  // 1. Collect all postgrid template IDs used by campaigns
  const postgridIds = new Set<string>();
  for (const c of campaigns) {
    if (c.front_template_id) postgridIds.add(c.front_template_id);
    if (c.back_template_id) postgridIds.add(c.back_template_id);
  }
  if (postgridIds.size === 0) return [];

  // 2. Resolve postgrid IDs → internal template UUIDs
  const { data: templateRows } = await supabase
    .from("templates")
    .select("id, postgrid_template_id")
    .in("postgrid_template_id", [...postgridIds]);

  if (!templateRows || templateRows.length === 0) return [];

  const postgridToUuid = new Map<string, string>();
  for (const t of templateRows) {
    postgridToUuid.set(t.postgrid_template_id, t.id);
  }

  // 3. Fetch all bundles for org with full front+back template data
  const { data: bundles, error: bundlesError } = await supabase
    .from("template_bundles")
    .select(`
      id, is_universal, organization_id, template_front_id, template_back_id, created_at, updated_at,
      front:templates!template_front_id(*),
      back:templates!template_back_id(*)
    `)
    .or(`organization_id.eq.${organizationId},is_universal.eq.true`);

  if (bundlesError || !bundles || bundles.length === 0) {
    console.error("Error fetching template bundles:", bundlesError);
    return [];
  }

  // 4. Build lookup: "frontUuid:backUuid" → bundle
  const bundleByPair = new Map<string, any>();
  for (const b of bundles) {
    bundleByPair.set(`${b.template_front_id}:${b.template_back_id}`, b);
  }

  // 5. Group campaigns by bundle
  const campaignsByBundle = new Map<string, { bundle: Record<string, any>; campaigns: CampaignData[] }>();
  for (const c of campaigns) {
    const frontUuid = postgridToUuid.get(c.front_template_id || "");
    const backUuid  = postgridToUuid.get(c.back_template_id || "");
    if (!frontUuid || !backUuid) continue;
    const bundle = bundleByPair.get(`${frontUuid}:${backUuid}`);
    if (!bundle) continue;
    if (!campaignsByBundle.has(bundle.id as string)) {
      campaignsByBundle.set(bundle.id as string, { bundle, campaigns: [] });
    }
    campaignsByBundle.get(bundle.id as string)!.campaigns.push(c);
  }

  // 6. Calculate metrics per bundle
  const result: Record<string, unknown>[] = [];
  const costPerLead   = 3;
  const revenuePerLead = 1000;

  for (const { bundle, campaigns: bundleCampaigns } of campaignsByBundle.values()) {
    const usagePercentage = campaigns.length > 0
      ? (bundleCampaigns.length / campaigns.length) * 100
      : 0;

    let bundlePostcardsSent = 0;
    let bundleLeads          = 0;

    for (const c of bundleCampaigns) {
      bundlePostcardsSent += (c.postcards_sent || 0);
      bundleLeads          += (c.leads_gen || 0);
    }

    const performancePercentage = bundlePostcardsSent > 0
      ? (bundleLeads / bundlePostcardsSent) * 100
      : 0;

    const totalCost    = bundlePostcardsSent * costPerLead;
    const totalRevenue = bundleLeads * revenuePerLead;
    const roi = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0;

    // Bundle object — same shape as getAllTemplatesBundles response
    const bundleObj = {
      id:             bundle.id,
      organization_id: bundle.organization_id,
      isUniversal:    bundle.is_universal || false,
      is_universal:   bundle.is_universal || false,
      // Top-level fields the frontend expects (backward-compatible)
      campaigns_used: bundleCampaigns.map((c: CampaignData) => c.id || ""),
      description:    (bundle.front?.description || bundle.back?.description || "").replace(/\s*(Front|Back)\s*$/i, "").trim(),
      postcard_size:  bundle.front?.postcard_size || bundle.back?.postcard_size || "",
      template_type:  "Bundle",
      live:           bundle.front?.live ?? true,
      deleted:        bundle.front?.deleted ?? false,
      created_by:     bundle.front?.created_by || null,
      front_template: bundle.front ? {
        id:                   bundle.front.id,
        postgrid_template_id: bundle.front.postgrid_template_id,
        description:          bundle.front.description,
        html:                 bundle.front.html,
        templateType:         bundle.front.template_type,
        postcardSize:         bundle.front.postcard_size,
        isUniversal:          bundle.front.is_universal   || false,
        isManualEdit:         bundle.front.is_manual_edit || false,
        campaigns_used:       bundle.front.campaigns_used || [],
        createdBy:            bundle.front.created_by,
        live:                 bundle.front.live,
        deleted:              bundle.front.deleted,
        created_at:           bundle.front.created_at,
        updated_at:           bundle.front.updated_at
      } : null,
      back_template: bundle.back ? {
        id:                   bundle.back.id,
        postgrid_template_id: bundle.back.postgrid_template_id,
        description:          bundle.back.description,
        html:                 bundle.back.html,
        templateType:         bundle.back.template_type,
        postcardSize:         bundle.back.postcard_size,
        isUniversal:          bundle.back.is_universal   || false,
        isManualEdit:         bundle.back.is_manual_edit || false,
        campaigns_used:       bundle.back.campaigns_used || [],
        createdBy:            bundle.back.created_by,
        live:                 bundle.back.live,
        deleted:              bundle.back.deleted,
        created_at:           bundle.back.created_at,
        updated_at:           bundle.back.updated_at
      } : null,
      created_at: bundle.created_at,
      updated_at: bundle.updated_at
    };

    result.push({
      template: bundleObj,
      performance: {
        usage:       Math.round(usagePercentage       * 100) / 100,
        performance: Math.round(performancePercentage * 100) / 100
      },
      estimated_roi_breakdown: {
        total_cost:            totalCost,
        total_revenue:         totalRevenue,
        roi_percentage:        Math.round(roi * 100) / 100,
        total_postcards_sent:  bundlePostcardsSent,
        total_leads_generated: bundleLeads,
        cost_per_lead:         costPerLead,
        revenue_per_lead:      revenuePerLead
      }
    });
  }

  result.sort((a: any, b: any) => b.performance.performance - a.performance.performance);
  return result;
}

/**
 * Compute ROI Analytics
 */
async function computeROIAnalytics(
  supabase: SupabaseClient,
  organizationId: string,
  _preferences: UserPreferences,
  campaignId?: string,
  _startDate?: string,
  _endDate?: string
): Promise<Record<string, unknown>> {

  // Build campaign query
  let campaignQuery = supabase
    .from("campaigns")
    .select("id, postgrid_tracker_id, postcards_sent, leads_gen, scan_rate, referral_id, paper_type, created_at, updated_at")
    .eq("organization_id", organizationId);

  if (campaignId) {
    campaignQuery = campaignQuery.eq("id", campaignId);
  }

  const { data: campaigns, error: campaignsError } = await campaignQuery;

  if (campaignsError) {
    console.error("Error fetching campaigns:", campaignsError);
    throw new Error("Failed to fetch campaigns");
  }

  const allCampaigns = campaigns || [];

  // Calculate total spent and total leads

  // Calculate total spent and total leads
  let totalPostcardsSent = 0;
  let totalLeadsGen = 0;
  let totalSpent = 0;
  const assumedRevenuePerLead = 1000;

  // For profit vs expense breakdown
  const campaignROIData: Array<{
    campaign_id: string,
    campaign_created_at: string,
    postcards_sent: number,
    leads_gen: number,
    cost: number,
    revenue: number,
    profit: number,
    roi: number
  }> = [];

  for (const campaign of allCampaigns) {
    const postcardsSent = campaign.postcards_sent || 0;
    totalPostcardsSent += postcardsSent;

    // Get leads from database
    const campaignLeads = campaign.leads_gen || 0;

    totalLeadsGen += campaignLeads;

    // Calculate campaign-level metrics
    const costPerPostcard = campaignCostPerPostcard(campaign);
    const campaignCost = postcardsSent * costPerPostcard;
    totalSpent += campaignCost;
    const campaignRevenue = campaignLeads * assumedRevenuePerLead;
    const campaignProfit = campaignRevenue - campaignCost;
    const campaignROI = campaignCost > 0 ? (campaignProfit / campaignCost) * 100 : 0;

    campaignROIData.push({
      campaign_id: campaign.id,
      campaign_created_at: campaign.created_at,
      postcards_sent: postcardsSent,
      leads_gen: campaignLeads,
      cost: campaignCost,
      revenue: campaignRevenue,
      profit: campaignProfit,
      roi: Math.round(campaignROI * 100) / 100
    });
  }

  // Calculate overall metrics (totalSpent accumulated in loop above)
  const estimatedRevenueGenerated = totalLeadsGen * assumedRevenuePerLead;
  const totalProfit = estimatedRevenueGenerated - totalSpent;
  const avgEstimatedROI = totalSpent > 0 ? (totalProfit / totalSpent) * 100 : 0;
  const estimatedCostRecoveryRatio = totalSpent > 0 ? estimatedRevenueGenerated / totalSpent : 0;

  // Fetch referrals to get job_details.value for profit calculation
  const referralIds = allCampaigns
    .map((c: CampaignData) => c.referral_id)
    .filter((id: string | null | undefined): id is string => id !== null && id !== undefined);

  const referralRevenueMap = new Map<string, number>();

  if (referralIds.length > 0) {
    const { data: referrals, error: referralsError } = await supabase
      .from("referrals")
      .select("id, campaign_id, job_details")
      .in("id", referralIds);

    if (!referralsError && referrals) {
      for (const referral of referrals) {
        if (referral.job_details && typeof (referral.job_details as any).value === 'number') {
          referralRevenueMap.set(referral.campaign_id as string, (referral.job_details as any).value);
        }
      }
    }
  }

  // Estimated Profit vs Expense Breakdown (chart-ready data)
  // Group by month for timeline visualization
  const profitVsExpenseByMonth = new Map<string, {
    month: string,
    total_expense: number,
    total_revenue_assumed: number,
    total_revenue_actual: number,
    profit_assumed: number,
    profit_actual: number
  }>();

  for (const campaign of allCampaigns) {
    const createdDate = new Date(campaign.created_at);
    const monthKey = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, '0')}`;

    if (!profitVsExpenseByMonth.has(monthKey)) {
      profitVsExpenseByMonth.set(monthKey, {
        month: monthKey,
        total_expense: 0,
        total_revenue_assumed: 0,
        total_revenue_actual: 0,
        profit_assumed: 0,
        profit_actual: 0
      });
    }

    const monthData = profitVsExpenseByMonth.get(monthKey)!;
    const postcardsSent = campaign.postcards_sent || 0;
    const expense = postcardsSent * campaignCostPerPostcard(campaign);

    // Get leads from database
    const campaignLeads = campaign.leads_gen || 0;

    const revenueAssumed = campaignLeads * assumedRevenuePerLead;
    const revenueActual = referralRevenueMap.get(campaign.id) || 0;

    monthData.total_expense += expense;
    monthData.total_revenue_assumed += revenueAssumed;
    monthData.total_revenue_actual += revenueActual;
    monthData.profit_assumed = monthData.total_revenue_assumed - monthData.total_expense;
    monthData.profit_actual = monthData.total_revenue_actual - monthData.total_expense;
  }

  const estimatedProfitVsExpenseBreakdown = Array.from(profitVsExpenseByMonth.values())
    .sort((a, b) => a.month.localeCompare(b.month));

  // Cost Breakdown (chart-ready data)
  // Break down costs by campaign
  const costBreakdown = allCampaigns.map(campaign => {
    const costPerPostcard = campaignCostPerPostcard(campaign);
    const totalCampaignCost = (campaign.postcards_sent || 0) * costPerPostcard;
    return {
      campaign_id: campaign.id,
      campaign_created_at: campaign.created_at,
      postcards_sent: campaign.postcards_sent || 0,
      cost_per_postcard: costPerPostcard,
      total_campaign_cost: totalCampaignCost,
      percentage_of_total: totalSpent > 0
        ? Math.round((totalCampaignCost / totalSpent) * 10000) / 100
        : 0
    };
  }).sort((a, b) => b.total_campaign_cost - a.total_campaign_cost);

  // Estimated ROI Timeline Per Campaign (chart-ready data)
  const estimatedROITimelinePerCampaign = campaignROIData
    .sort((a, b) => new Date(a.campaign_created_at).getTime() - new Date(b.campaign_created_at).getTime())
    .map(data => ({
      campaign_id: data.campaign_id,
      date: data.campaign_created_at,
      postcards_sent: data.postcards_sent,
      leads_generated: data.leads_gen,
      cost: data.cost,
      revenue: data.revenue,
      profit: data.profit,
      roi_percentage: data.roi,
      cumulative_cost: 0, // Will be calculated below
      cumulative_revenue: 0, // Will be calculated below
      cumulative_roi: 0 // Will be calculated below
    }));

  // Calculate cumulative values
  let cumulativeCost = 0;
  let cumulativeRevenue = 0;

  for (const item of estimatedROITimelinePerCampaign) {
    cumulativeCost += item.cost;
    cumulativeRevenue += item.revenue;
    item.cumulative_cost = cumulativeCost;
    item.cumulative_revenue = cumulativeRevenue;
    item.cumulative_roi = cumulativeCost > 0
      ? Math.round(((cumulativeRevenue - cumulativeCost) / cumulativeCost) * 10000) / 100
      : 0;
  }

  const analyticsData: any = {
    total_spent: totalSpent,
    total_spent_display: enrichCurrency(totalSpent, _preferences.currency),
    total_leads_gen: totalLeadsGen,
    avg_estimated_roi: Math.round(avgEstimatedROI * 100) / 100,
    estimated_revenue_generated: estimatedRevenueGenerated,
    estimated_revenue_generated_display: enrichCurrency(estimatedRevenueGenerated, _preferences.currency),
    estimated_cost_recovery_ratio: Math.round(estimatedCostRecoveryRatio * 100) / 100,
    estimated_profit_vs_expense_breakdown: estimatedProfitVsExpenseBreakdown.map(item => ({
        ...item,
        total_expense_display: enrichCurrency(item.total_expense, _preferences.currency),
        total_revenue_assumed_display: enrichCurrency(item.total_revenue_assumed, _preferences.currency),
        total_revenue_actual_display: enrichCurrency(item.total_revenue_actual, _preferences.currency),
        profit_assumed_display: enrichCurrency(item.profit_assumed, _preferences.currency),
        profit_actual_display: enrichCurrency(item.profit_actual, _preferences.currency)
    })),
    cost_breakdown: costBreakdown.map(item => ({
        ...item,
        cost_per_postcard_display: enrichCurrency(item.cost_per_postcard, _preferences.currency),
        total_campaign_cost_display: enrichCurrency(item.total_campaign_cost, _preferences.currency)
    })),
    estimated_roi_timeline_per_campaign: estimatedROITimelinePerCampaign.map(item => ({
        ...item,
        cost_display: enrichCurrency(item.cost, _preferences.currency),
        revenue_display: enrichCurrency(item.revenue, _preferences.currency),
        profit_display: enrichCurrency(item.profit, _preferences.currency),
        cumulative_cost_display: enrichCurrency(item.cumulative_cost, _preferences.currency),
        cumulative_revenue_display: enrichCurrency(item.cumulative_revenue, _preferences.currency)
    }))
  };

  return analyticsData;
}
