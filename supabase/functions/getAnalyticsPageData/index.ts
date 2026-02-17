import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { getUserPreferences, UserPreferences } from "../_shared/preferences.ts";
import { enrichCurrency } from "../_shared/currency.ts";

/**
 * Get Analytics Page Data Edge Function
 * Returns detailed analytics data with comprehensive metrics
 *
 * Business Rules:
 * - Organization-based (user must be in organization)
 * - Supports optional campaign filtering and date range filtering
 * - Computes fresh data on every call but caches for fallback
 * - Uses Linkly API for QR scan tracking data
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

interface LinklyTrafficData {
  traffic: Array<{
    y: number;
    t: string;
  }>;
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

    // Get Linkly credentials from headers
    const linklyApiKey = req.headers.get("x-linkly-api-key");
    const linklyWorkspaceId = req.headers.get("x-linkly-workspace-id");

    if (!linklyApiKey || !linklyWorkspaceId) {
      return errorResponse(
        "MISSING_CREDENTIALS",
        "Linkly credentials required in headers: x-linkly-api-key, x-linkly-workspace-id",
        400
      );
    }

    // Fetch user preferences for enrichment
    const preferences = await getUserPreferences(supabase, user.userId);

    // Try to compute fresh analytics
    let analyticsData: any;

    try {
      if (analyticsType === "OVERVIEW") {
        analyticsData = await computeOverviewAnalytics(
          supabase,
          organizationId,
          preferences,
          selected_campaign_id,
          selected_start_date,
          selected_end_date,
          linklyApiKey,
          linklyWorkspaceId
        );
      } else if (analyticsType === "CAMPAIGN_PERFORMANCE") {
        analyticsData = await computeCampaignPerformanceAnalytics(
          supabase,
          organizationId,
          preferences,
          selected_campaign_id,
          selected_start_date,
          selected_end_date,
          linklyApiKey,
          linklyWorkspaceId
        );
      } else if (analyticsType === "ROI") {
        analyticsData = await computeROIAnalytics(
          supabase,
          organizationId,
          preferences,
          selected_campaign_id,
          selected_start_date,
          selected_end_date,
          linklyApiKey,
          linklyWorkspaceId
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

  } catch (error) {
    console.error("Unexpected error in getAnalyticsPageData:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});

/**
 * Compute Overview Analytics
 */
async function computeOverviewAnalytics(
  supabase: any,
  organizationId: string,
  preferences: UserPreferences,
  campaignId?: string,
  startDate?: string,
  endDate?: string,
  linklyApiKey?: string,
  linklyWorkspaceId?: string
): Promise<any> {

  // Build campaign query
  let campaignQuery = supabase
    .from("campaigns")
    .select("id, postgrid_tracker_id, postcards_sent, leads_gen, scan_rate, referral_id, created_at, updated_at")
    .eq("organization_id", organizationId);

  if (campaignId) {
    campaignQuery = campaignQuery.eq("id", campaignId);
  }

  const { data: campaigns, error: campaignsError } = await campaignQuery;

  if (campaignsError) {
    console.error("Error fetching campaigns:", campaignsError);
    throw new Error(`Failed to fetch campaigns: ${campaignsError.message}`);
  }

  const allCampaigns = campaigns || [];
  const totalCampaigns = allCampaigns.length;

  // Calculate date boundaries
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let filterStartDate = startDate ? new Date(startDate) : null;
  let filterEndDate = endDate ? new Date(endDate) : null;

  // Sync Linkly data for campaigns with tracker_id
  let linklyDataMap = new Map<string, Array<{y: number, t: string}>>();

  for (const campaign of allCampaigns) {
    if (campaign.postgrid_tracker_id && linklyApiKey && linklyWorkspaceId) {
      try {
        const linklyUrl = `https://app.linklyhq.com/api/v1/workspace/${linklyWorkspaceId}/clicks?link_id=${campaign.postgrid_tracker_id}&bots=false&unique=false&format=json&timezone=America%2FNew_York&frequency=day&api_key=${encodeURIComponent(linklyApiKey)}`;

        const linklyResponse = await fetch(linklyUrl, {
          method: "GET",
          headers: {
            "accept": "application/json",
          },
        });

        if (linklyResponse.ok) {
          const linklyData: LinklyTrafficData = await linklyResponse.json();
          linklyDataMap.set(campaign.id, linklyData.traffic);
        }
      } catch (error) {
        console.error(`Error fetching Linkly data for campaign ${campaign.id}:`, error);
      }
    }
  }

  // Calculate metrics
  let totalPostcardsSent = 0;
  let totalQrScans = 0;
  let totalQrScansToday = 0;
  let totalQrScansThisWeek = 0;
  let totalQrScansThisMonth = 0;
  let totalQrScansInRange = 0;

  // Track campaigns with leads for top performers
  const campaignsWithLeads: Array<{campaign: any, leads: number, roi: number}> = [];

  for (const campaign of allCampaigns) {
    totalPostcardsSent += campaign.postcards_sent || 0;

    // Get Linkly data if available
    const linklyTraffic = linklyDataMap.get(campaign.id);
    let campaignLeads = 0;
    let leadsToday = 0;
    let leadsThisWeek = 0;
    let leadsThisMonth = 0;
    let leadsInRange = 0;

    if (linklyTraffic && linklyTraffic.length > 0) {
      for (const traffic of linklyTraffic) {
        const trafficDate = new Date(traffic.t);
        campaignLeads += traffic.y;

        // Daily
        if (trafficDate >= todayStart) {
          leadsToday += traffic.y;
        }

        // Weekly
        if (trafficDate >= weekStart) {
          leadsThisWeek += traffic.y;
        }

        // Monthly
        if (trafficDate >= monthStart) {
          leadsThisMonth += traffic.y;
        }

        // Custom range
        if (filterStartDate && filterEndDate && trafficDate >= filterStartDate && trafficDate <= filterEndDate) {
          leadsInRange += traffic.y;
        }
      }
    } else {
      // Fallback to leads_gen from database
      campaignLeads = campaign.leads_gen || 0;

      // For date filtering, use updated_at as proxy
      const updatedAt = new Date(campaign.updated_at);
      if (updatedAt >= todayStart) leadsToday = campaignLeads;
      if (updatedAt >= weekStart) leadsThisWeek = campaignLeads;
      if (updatedAt >= monthStart) leadsThisMonth = campaignLeads;
      if (filterStartDate && filterEndDate && updatedAt >= filterStartDate && updatedAt <= filterEndDate) {
        leadsInRange = campaignLeads;
      }
    }

    totalQrScans += campaignLeads;
    totalQrScansToday += leadsToday;
    totalQrScansThisWeek += leadsThisWeek;
    totalQrScansThisMonth += leadsThisMonth;
    totalQrScansInRange += leadsInRange;

    // Calculate ROI for this campaign
    // Cost per lead = $3, Revenue per lead = $1000
    const costPerLead = 3;
    const revenuePerLead = 1000;
    const totalCost = (campaign.postcards_sent || 0) * costPerLead;
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
  const totalCost = totalPostcardsSent * 3;
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
  let topReferralsByLeads: any[] = [];

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
        topReferralsByLeads = referrals;
      }
    }
  }

  // Get geographic distribution (addresses from location_zones)
  const { data: locationZones, error: zonesError } = await supabase
    .from("location_zones")
    .select("id, addresses, campaign_id")
    .eq("organization_id", organizationId);

  let reachAddresses: any[] = [];

  if (!zonesError && locationZones) {
    for (const zone of locationZones) {
      if (!campaignId || zone.campaign_id === campaignId) {
        if (Array.isArray(zone.addresses)) {
          // Filter addresses with verified/Valid status
          const validAddresses = zone.addresses.filter((addr: any) =>
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
    total_qr_scans: totalQrScans,
    total_qr_scans: totalQrScans,
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
  if (filterStartDate && filterEndDate) {
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
  supabase: any,
  organizationId: string,
  analyticsType: string,
  campaignId?: string,
  startDate?: string,
  endDate?: string,
  data?: any
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
  supabase: any,
  organizationId: string,
  analyticsType: string,
  campaignId?: string,
  startDate?: string,
  endDate?: string
): Promise<any | null> {
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

    return data.data;
  } catch (error) {
    console.error("Error getting cached analytics:", error);
    return null;
  }
}

/**
 * Compute Campaign Performance Analytics
 */
async function computeCampaignPerformanceAnalytics(
  supabase: any,
  organizationId: string,
  preferences: UserPreferences,
  campaignId?: string,
  startDate?: string,
  endDate?: string,
  linklyApiKey?: string,
  linklyWorkspaceId?: string
): Promise<any> {

  // Build campaign query
  let campaignQuery = supabase
    .from("campaigns")
    .select("id, postgrid_tracker_id, postcards_sent, leads_gen, scan_rate, zone_id, front_template_id, back_template_id, created_at, updated_at")
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

  let filterStartDate = startDate ? new Date(startDate) : null;
  let filterEndDate = endDate ? new Date(endDate) : null;

  // Sync Linkly data for campaigns with tracker_id
  let linklyDataMap = new Map<string, Array<{y: number, t: string}>>();

  for (const campaign of allCampaigns) {
    if (campaign.postgrid_tracker_id && linklyApiKey && linklyWorkspaceId) {
      try {
        const linklyUrl = `https://app.linklyhq.com/api/v1/workspace/${linklyWorkspaceId}/clicks?link_id=${campaign.postgrid_tracker_id}&bots=false&unique=false&format=json&timezone=America%2FNew_York&frequency=day&api_key=${encodeURIComponent(linklyApiKey)}`;

        const linklyResponse = await fetch(linklyUrl, {
          method: "GET",
          headers: {
            "accept": "application/json",
          },
        });

        if (linklyResponse.ok) {
          const linklyData: LinklyTrafficData = await linklyResponse.json();
          linklyDataMap.set(campaign.id, linklyData.traffic);
        }
      } catch (error) {
        console.error(`Error fetching Linkly data for campaign ${campaign.id}:`, error);
      }
    }
  }

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

    // Get Linkly data if available
    const linklyTraffic = linklyDataMap.get(campaign.id);
    let campaignLeads = 0;
    let leadsToday = 0;
    let leadsWeek = 0;
    let leadsMonth = 0;

    if (linklyTraffic && linklyTraffic.length > 0) {
      for (const traffic of linklyTraffic) {
        const trafficDate = new Date(traffic.t);
        campaignLeads += traffic.y;

        if (trafficDate >= todayStart) leadsToday += traffic.y;
        if (trafficDate >= weekStart) leadsWeek += traffic.y;
        if (trafficDate >= monthStart) leadsMonth += traffic.y;
      }
    } else {
      // Fallback to leads_gen from database
      campaignLeads = campaign.leads_gen || 0;

      // Use updated_at as proxy for date filtering
      const updatedAt = new Date(campaign.updated_at);
      if (updatedAt >= todayStart) leadsToday = campaignLeads;
      if (updatedAt >= weekStart) leadsWeek = campaignLeads;
      if (updatedAt >= monthStart) leadsMonth = campaignLeads;
    }

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
    allCampaigns,
    linklyDataMap
  );

  const analyticsData: any = {
    total_postcards_sent: totalPostcardsSent,
    total_qr_scans: totalQrScans,
    total_conversion_rate: Math.round(totalConversionRate * 100) / 100,
    cost_per_lead: 3,
    cost_per_lead_display: enrichCurrency(3, preferences.currency),
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
 * Calculate Template Performance
 */
async function calculateTemplatePerformance(
  supabase: any,
  organizationId: string,
  campaigns: any[],
  linklyDataMap: Map<string, Array<{y: number, t: string}>>
): Promise<any[]> {

  // Collect all template IDs from campaigns
  const templateIds = new Set<string>();
  const postgridTemplateIds = new Set<string>();

  for (const campaign of campaigns) {
    if (campaign.front_template_id) postgridTemplateIds.add(campaign.front_template_id);
    if (campaign.back_template_id) postgridTemplateIds.add(campaign.back_template_id);
  }

  // Fetch templates (both organization and universal)
  const { data: orgTemplates, error: orgTemplatesError } = await supabase
    .from("templates")
    .select("*")
    .or(`organization_id.eq.${organizationId},is_universal.eq.true`);

  if (orgTemplatesError) {
    console.error("Error fetching templates:", orgTemplatesError);
    return [];
  }

  const allTemplates = orgTemplates || [];
  const templatePerformanceList: any[] = [];

  // Calculate performance for each template
  for (const template of allTemplates) {
    const templatePostgridId = template.postgrid_template_id;

    // Find campaigns using this template
    const campaignsUsingTemplate = campaigns.filter(c =>
      c.front_template_id === templatePostgridId || c.back_template_id === templatePostgridId
    );

    if (campaignsUsingTemplate.length === 0) {
      continue; // Skip templates not used in any campaign
    }

    // Calculate usage percentage (how many campaigns use this template)
    const usagePercentage = campaigns.length > 0
      ? (campaignsUsingTemplate.length / campaigns.length) * 100
      : 0;

    // Calculate performance metrics for campaigns using this template
    let totalPostcards = 0;
    let totalLeads = 0;

    for (const campaign of campaignsUsingTemplate) {
      totalPostcards += campaign.postcards_sent || 0;

      // Get leads from Linkly data if available
      const linklyTraffic = linklyDataMap.get(campaign.id);
      if (linklyTraffic && linklyTraffic.length > 0) {
        const campaignLeads = linklyTraffic.reduce((sum, traffic) => sum + traffic.y, 0);
        totalLeads += campaignLeads;
      } else {
        totalLeads += campaign.leads_gen || 0;
      }
    }

    // Calculate performance percentage (conversion rate for this template)
    const performancePercentage = totalPostcards > 0
      ? (totalLeads / totalPostcards) * 100
      : 0;

    // Calculate ROI
    const costPerLead = 3;
    const revenuePerLead = 1000;
    const totalCost = totalPostcards * costPerLead;
    const totalRevenue = totalLeads * revenuePerLead;
    const roi = totalCost > 0 ? ((totalRevenue - totalCost) / totalCost) * 100 : 0;

    templatePerformanceList.push({
      template: template,
      performance: {
        usage: Math.round(usagePercentage * 100) / 100,
        performance: Math.round(performancePercentage * 100) / 100
      },
      estimated_roi_breakdown: {
        total_cost: totalCost,
        total_revenue: totalRevenue,
        roi_percentage: Math.round(roi * 100) / 100,
        total_postcards_sent: totalPostcards,
        total_leads_generated: totalLeads,
        cost_per_lead: costPerLead,
        revenue_per_lead: revenuePerLead
      }
    });
  }

  // Sort by performance (descending)
  templatePerformanceList.sort((a, b) => b.performance.performance - a.performance.performance);

  return templatePerformanceList;
}

/**
 * Compute ROI Analytics
 */
async function computeROIAnalytics(
  supabase: any,
  organizationId: string,
  preferences: UserPreferences,
  campaignId?: string,
  startDate?: string,
  endDate?: string,
  linklyApiKey?: string,
  linklyWorkspaceId?: string
): Promise<any> {

  // Build campaign query
  let campaignQuery = supabase
    .from("campaigns")
    .select("id, postgrid_tracker_id, postcards_sent, leads_gen, scan_rate, referral_id, created_at, updated_at")
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

  // Sync Linkly data for campaigns with tracker_id
  let linklyDataMap = new Map<string, Array<{y: number, t: string}>>();

  for (const campaign of allCampaigns) {
    if (campaign.postgrid_tracker_id && linklyApiKey && linklyWorkspaceId) {
      try {
        const linklyUrl = `https://app.linklyhq.com/api/v1/workspace/${linklyWorkspaceId}/clicks?link_id=${campaign.postgrid_tracker_id}&bots=false&unique=false&format=json&timezone=America%2FNew_York&frequency=day&api_key=${encodeURIComponent(linklyApiKey)}`;

        const linklyResponse = await fetch(linklyUrl, {
          method: "GET",
          headers: {
            "accept": "application/json",
          },
        });

        if (linklyResponse.ok) {
          const linklyData: LinklyTrafficData = await linklyResponse.json();
          linklyDataMap.set(campaign.id, linklyData.traffic);
        }
      } catch (error) {
        console.error(`Error fetching Linkly data for campaign ${campaign.id}:`, error);
      }
    }
  }

  // Calculate total spent and total leads
  let totalPostcardsSent = 0;
  let totalLeadsGen = 0;
  const costPerPostcard = 3;
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

    // Get leads from Linkly data if available
    const linklyTraffic = linklyDataMap.get(campaign.id);
    let campaignLeads = 0;

    if (linklyTraffic && linklyTraffic.length > 0) {
      campaignLeads = linklyTraffic.reduce((sum, traffic) => sum + traffic.y, 0);
    } else {
      campaignLeads = campaign.leads_gen || 0;
    }

    totalLeadsGen += campaignLeads;

    // Calculate campaign-level metrics
    const campaignCost = postcardsSent * costPerPostcard;
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

  // Calculate overall metrics
  const totalSpent = totalPostcardsSent * costPerPostcard;
  const estimatedRevenueGenerated = totalLeadsGen * assumedRevenuePerLead;
  const totalProfit = estimatedRevenueGenerated - totalSpent;
  const avgEstimatedROI = totalSpent > 0 ? (totalProfit / totalSpent) * 100 : 0;
  const estimatedCostRecoveryRatio = totalSpent > 0 ? estimatedRevenueGenerated / totalSpent : 0;

  // Fetch referrals to get job_details.value for profit calculation
  const referralIds = allCampaigns
    .map(c => c.referral_id)
    .filter(id => id !== null && id !== undefined);

  let referralRevenueMap = new Map<string, number>();

  if (referralIds.length > 0) {
    const { data: referrals, error: referralsError } = await supabase
      .from("referrals")
      .select("id, campaign_id, job_details")
      .in("id", referralIds);

    if (!referralsError && referrals) {
      for (const referral of referrals) {
        if (referral.job_details && typeof referral.job_details.value === 'number') {
          referralRevenueMap.set(referral.campaign_id, referral.job_details.value);
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
    const expense = postcardsSent * costPerPostcard;

    // Get leads from Linkly data if available
    const linklyTraffic = linklyDataMap.get(campaign.id);
    let campaignLeads = 0;

    if (linklyTraffic && linklyTraffic.length > 0) {
      campaignLeads = linklyTraffic.reduce((sum, traffic) => sum + traffic.y, 0);
    } else {
      campaignLeads = campaign.leads_gen || 0;
    }

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
  const costBreakdown = allCampaigns.map(campaign => ({
    campaign_id: campaign.id,
    campaign_created_at: campaign.created_at,
    postcards_sent: campaign.postcards_sent || 0,
    cost_per_postcard: costPerPostcard,
    total_campaign_cost: (campaign.postcards_sent || 0) * costPerPostcard,
    percentage_of_total: totalSpent > 0
      ? Math.round(((campaign.postcards_sent || 0) * costPerPostcard / totalSpent) * 10000) / 100
      : 0
  })).sort((a, b) => b.total_campaign_cost - a.total_campaign_cost);

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
    total_spent_display: enrichCurrency(totalSpent, preferences.currency),
    total_leads_gen: totalLeadsGen,
    avg_estimated_roi: Math.round(avgEstimatedROI * 100) / 100,
    estimated_revenue_generated: estimatedRevenueGenerated,
    estimated_revenue_generated_display: enrichCurrency(estimatedRevenueGenerated, preferences.currency),
    estimated_cost_recovery_ratio: Math.round(estimatedCostRecoveryRatio * 100) / 100,
    estimated_profit_vs_expense_breakdown: estimatedProfitVsExpenseBreakdown.map(item => ({
        ...item,
        total_expense_display: enrichCurrency(item.total_expense, preferences.currency),
        total_revenue_assumed_display: enrichCurrency(item.total_revenue_assumed, preferences.currency),
        total_revenue_actual_display: enrichCurrency(item.total_revenue_actual, preferences.currency),
        profit_assumed_display: enrichCurrency(item.profit_assumed, preferences.currency),
        profit_actual_display: enrichCurrency(item.profit_actual, preferences.currency)
    })),
    cost_breakdown: costBreakdown.map(item => ({
        ...item,
        cost_per_postcard_display: enrichCurrency(item.cost_per_postcard, preferences.currency),
        total_campaign_cost_display: enrichCurrency(item.total_campaign_cost, preferences.currency)
    })),
    estimated_roi_timeline_per_campaign: estimatedROITimelinePerCampaign.map(item => ({
        ...item,
        cost_display: enrichCurrency(item.cost, preferences.currency),
        revenue_display: enrichCurrency(item.revenue, preferences.currency),
        profit_display: enrichCurrency(item.profit, preferences.currency),
        cumulative_cost_display: enrichCurrency(item.cumulative_cost, preferences.currency),
        cumulative_revenue_display: enrichCurrency(item.cumulative_revenue, preferences.currency)
    }))
  };

  return analyticsData;
}
