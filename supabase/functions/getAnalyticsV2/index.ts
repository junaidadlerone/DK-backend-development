import {
  corsResponse,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { getUserPreferences } from "../_shared/preferences.ts";
import { enrichCurrency } from "../_shared/currency.ts";

/**
 * Get Analytics V2 Edge Function
 * Returns postcard-level delivery analytics based on individual PostGrid postcard records.
 *
 * Unlike getAnalytics (which uses aggregate campaign counters), this function queries
 * the postcard_sends table for per-postcard status data and payment_history for
 * accurate spend figures.
 *
 * PostGrid provides TWO separate tracking fields per postcard:
 *
 *   status  (standard lifecycle — all orders):
 *     ready | printing | processed_for_delivery | completed | cancelled
 *
 *   imbStatus  (Intelligent-Mail Tracking — US only, nullable):
 *     entered_mail_stream | out_for_delivery | returned_to_sender
 *
 * We store these in postcard_sends.postgrid_status and postcard_sends.imb_status.
 *
 * Business Rules:
 * - Organization-based (user must be in organization)
 * - All roles (ADMIN, MARKETER, TECHNICIAN)
 * - Always computes fresh data (no caching)
 *
 * Supported types:
 * - dashboard_cards: in_flight_postcards, delivered, delivery_rate, spent_to_date
 * - delivery_funnel: full status breakdown as percentages of total_postcards_sent
 * - waste_meter:     wasted, returned, cancelled, and delayed postcard counts + dollar costs
 * - scan_trend:         QR code scan totals, unique scans, scan rate, and day-of-week breakdown
 * - recent_scans:       per-campaign list of recent QR scans with postcard info and timestamp
 * - campaign_leaderboard: top 5 campaigns ranked by total QR scans
 */

// Standard PostGrid `status` values that mean the postcard is still in motion
const IN_FLIGHT_STATUSES = ["ready", "printing", "processed_for_delivery"];

// Price charged per postcard (USD). Used for waste_meter dollar calculations.
const PRICE_PER_POSTCARD = 3.00;

// Waste meter risk thresholds — based on (wasted + delayed) as % of total sent
const WASTE_STATUS_THRESHOLDS = {
  HEALTHY: 5,   // < 5%  → Healthy
  AT_RISK: 15,  // 5–15% → At Risk
  // > 15%   → Critical
} as const;

type WasteMeterStatus = "Healthy" | "At Risk" | "Critical";

interface AnalyticsV2Request {
  type: string;
  campaign_ids?: string[];
  last_24hours?: boolean;
  last_week?: boolean;
  last_month?: boolean;
}

type ScanPeriod = "last_24hours" | "last_week" | "last_month" | "all_time";

/**
 * Optional filters that can be applied to any analytics type.
 * campaign_ids — scope results to one or more campaigns (must belong to the org).
 * since        — ISO 8601 cutoff; only include records/events at or after this time.
 * period       — controls scan_trend breakdown granularity.
 */
interface AnalyticsFilters {
  campaign_ids?: string[];
  since?: string;
  period: ScanPeriod;
  timeFilter?: "last_24hours" | "last_week" | "last_month";
}

function parseFilters(body: AnalyticsV2Request): AnalyticsFilters {
  const filters: AnalyticsFilters = { period: "all_time" };
  if (Array.isArray(body.campaign_ids) && body.campaign_ids.length > 0) {
    filters.campaign_ids = body.campaign_ids;
  }
  const now = Date.now();
  if (body.last_24hours === true) {
    filters.since = new Date(now - 86_400_000).toISOString();
    filters.timeFilter = "last_24hours";
    filters.period = "last_24hours";
  } else if (body.last_week === true) {
    const startOfWeek = new Date();
    startOfWeek.setUTCHours(0, 0, 0, 0);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());
    filters.since = startOfWeek.toISOString();
    filters.timeFilter = "last_week";
    filters.period = "last_week";
  } else if (body.last_month === true) {
    filters.since = new Date(now - 30 * 86_400_000).toISOString();
    filters.timeFilter = "last_month";
    filters.period = "last_month";
  }
  return filters;
}

interface DashboardCardsData {
  in_flight_postcards: number;
  delivered: number;
  delivery_rate: number;
  total_scans: number;
  spent_to_date: number;
  spent_to_date_display: {
    value: number;
    currency_code: string;
    symbol: string;
    formatted: string;
  };
}

interface FunnelBucket {
  count: number;
  percentage: number;
}

interface DeliveryFunnelData {
  total_postcards_sent: number;
  // From postgrid_status (standard field)
  delivered: FunnelBucket;
  processed: FunnelBucket;
  printing: FunnelBucket;
  ready: FunnelBucket;
  cancelled: FunnelBucket;
  // From imb_status (Intelligent-Mail Tracking, US only)
  in_transit: FunnelBucket;
  returned: FunnelBucket;
}

interface WasteMeterData {
  status: WasteMeterStatus;
  total_postcards_sent: number;
  // Combined wasted = returned + cancelled
  total_pieces_wasted: number;
  total_amount_wasted: number;
  // Returned (imbStatus = returned_to_sender)
  total_pieces_returned: number;
  total_amount_returned: number;
  // Cancelled (postgrid_status = cancelled)
  total_pieces_cancelled: number;
  total_amount_cancelled: number;
  // Delayed: not completed/cancelled, >= 7 working days since sent
  total_pieces_delayed: number;
  total_amount_delayed: number;
}

// Breakdown shapes per period — use the matching interface based on the request filter sent.
interface ScanTrendBreakdown24Hours {
  "12am": number;
  "2am": number;
  "4am": number;
  "6am": number;
  "8am": number;
  "10am": number;
  "12pm": number;
  "2pm": number;
  "4pm": number;
  "6pm": number;
  "8pm": number;
  "10pm": number;
}

interface ScanTrendBreakdownLastWeek {
  sunday_scans: number;
  monday_scans: number;
  tuesday_scans: number;
  wednesday_scans: number;
  thursday_scans: number;
  friday_scans: number;
  saturday_scans: number;
}

// last_month: 15 rolling day keys, e.g. "Apr 6" … "Apr 20"
type ScanTrendBreakdownLastMonth = Record<string, number>;

// all_time: 6 monthly keys, e.g. "Nov 2025" … "Apr 2026"
type ScanTrendBreakdownAllTime = Record<string, number>;

interface ScanTrendData {
  total_scans: number;
  unique_scans: number;
  scan_rate: number;
  breakdown:
    | ScanTrendBreakdown24Hours
    | ScanTrendBreakdownLastWeek
    | ScanTrendBreakdownLastMonth
    | ScanTrendBreakdownAllTime;
}

interface RecentScanEvent {
  postcard_number: number;
  scan_address: string;
  scan_time_stamp: string;
}

interface CampaignRecentScans {
  campaign_id: string;
  campaign_name: string;
  scans: RecentScanEvent[];
}

interface RecentScansData {
  data: CampaignRecentScans[];
}

interface LeaderboardEntry {
  campaign_name: string;
  total_scans: number;
  total_postcards_sent: number;
  scan_rate: number;
  ranking_position: number;
}

interface CampaignLeaderboardData {
  leaderboard: LeaderboardEntry[];
}

interface CampaignPerformanceData {
  top_performers: LeaderboardEntry[];
  bottom_performers: LeaderboardEntry[];
}

interface ScanTypeBucket {
  count: number;
  percentage: number;
}

interface ScanTypeBreakdown {
  total_scans: number;
  location_zone: ScanTypeBucket;
  referral: ScanTypeBucket;
  addresses_list: ScanTypeBucket;
}

interface ScanTrendByTypeDayPoint extends ScanTypeBreakdown {
  date: string;
  day: string;
}

interface ScanTrendByTypeWeekPoint extends ScanTypeBreakdown {
  week: string;
  range: string;
}

interface ScanTrendByTypeMonthPoint extends ScanTypeBreakdown {
  month: string;
}

interface ScanTrendByTypeData {
  daily_data: ScanTrendByTypeDayPoint[];
  weekly_data: ScanTrendByTypeWeekPoint[];
  monthly_data: ScanTrendByTypeMonthPoint[];
}

interface PerformanceDayPoint {
  date: string;
  day: string;
  delivery_rate: number;
  scan_rate: number;
  total_volume: number;
}

interface PerformanceWeekPoint {
  week: string;
  range: string;
  delivery_rate: number;
  scan_rate: number;
  total_volume: number;
}

interface PerformanceMonthPoint {
  month: string;
  delivery_rate: number;
  scan_rate: number;
  total_volume: number;
}

interface PerformanceTrendData {
  total_delivery_rate: number;
  total_scan_rate: number;
  daily_data: PerformanceDayPoint[];
  weekly_data: PerformanceWeekPoint[];
  monthly_data: PerformanceMonthPoint[];
}

interface PostcardOverviewSummary {
  delivered_and_scanned: number;
  delivered_but_not_scanned: number;
  in_transit: number;
  returned_cancelled: number;
}

interface CampaignOverviewEntry extends PostcardOverviewSummary {
  campaign_id: string;
  campaign_name: string;
  total_postcards_sent: number;
}

interface PostcardOverviewData {
  total_summary: PostcardOverviewSummary;
  campaign_summary: CampaignOverviewEntry[];
}

type ActiveCampaignStatus = "On Track" | "Delayed" | "At Risk" | "Pending";

interface ActiveCampaignEntry {
  campaign_id: string;
  campaign_name: string;
  days_running: number;
  in_flight: number;
  scans: number;
  delivery_rate: number;
  status: ActiveCampaignStatus;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();

    const user = getUserFromRequest(req);
    if (!user) {
      return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);
    }

    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403,
      );
    }

    let body: AnalyticsV2Request;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON format in request body", 400);
    }

    const { type } = body;

    if (!type || typeof type !== "string") {
      return errorResponse("INVALID_INPUT", "type is required and must be a string", 400);
    }

    const analyticsType = type.toLowerCase();
    const filters = parseFilters(body);

    // Return simulated data for demo orgs listed in ANALYTICS_SIMULATED_ORG_IDS secret
    const simulatedOrgIds = (Deno.env.get("ANALYTICS_SIMULATED_ORG_IDS") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (simulatedOrgIds.includes(organizationId)) {
      const simData = buildSimulatedAnalytics(analyticsType, filters);
      if (simData !== null) {
        const envelope = analyticsType === "scan_trend"
          ? { success: true, data: simData }
          : { status: "success", message: "Analytics computed successfully", data: simData };
        return successResponse(envelope, 200);
      }
    }

    switch (analyticsType) {
      case "dashboard_cards": {
        const preferences = await getUserPreferences(supabase, user.userId);
        const data = await computeDashboardCards(supabase, organizationId, preferences, filters);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      case "delivery_funnel": {
        const data = await computeDeliveryFunnel(supabase, organizationId, filters);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      case "waste_meter": {
        const preferences = await getUserPreferences(supabase, user.userId);
        const data = await computeWasteMeter(supabase, organizationId, preferences, filters);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      case "scan_trend": {
        const data = await computeScanTrend(supabase, organizationId, filters);
        return successResponse({ success: true, data }, 200);
      }

      case "recent_scans": {
        const data = await computeRecentScans(supabase, organizationId, filters);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      case "campaign_leaderboard": {
        const data = await computeCampaignLeaderboard(supabase, organizationId, filters);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      case "performance_trend": {
        const data = await computePerformanceTrend(supabase, organizationId, filters);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      case "campaign_performance": {
        const data = await computeCampaignPerformance(supabase, organizationId, filters);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      case "scan_trend_by_type": {
        const data = await computeScanTrendByType(supabase, organizationId, filters);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      case "postcard_overview": {
        const data = await computePostcardOverview(supabase, organizationId, filters);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      case "active_campaigns": {
        const data = await computeActiveCampaigns(supabase, organizationId, filters);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      default:
        return errorResponse(
          "INVALID_TYPE",
          `Analytics type "${type}" is not supported. Supported types: dashboard_cards, delivery_funnel, waste_meter, scan_trend, recent_scans, campaign_leaderboard, performance_trend, campaign_performance, scan_trend_by_type, postcard_overview, active_campaigns`,
          400,
        );
    }
  } catch (error) {
    console.error("Unexpected error in getAnalyticsV2:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500,
    );
  }
});

/**
 * Compute Dashboard Cards Analytics
 *
 * Metrics:
 * - in_flight_postcards: count of postcards with postgrid_status IN (ready, printing, processed_for_delivery)
 * - delivered:           count of postcards with postgrid_status = completed
 * - delivery_rate:       (delivered / total_sent) * 100
 * - spent_to_date:       sum of amount_paid from payment_history for this org
 */
async function computeDashboardCards(
  supabase: any,
  organizationId: string,
  preferences: any,
  filters: AnalyticsFilters,
): Promise<DashboardCardsData> {
  const postgridApiKey =
    Deno.env.get("POSTGRID_POSTCARD_API_KEY") ??
    Deno.env.get("VITE_POSTGRID_POSTCARD_API_KEY");

  let postcardsQuery = supabase
    .from("postcard_sends")
    .select("postgrid_status")
    .eq("organization_id", organizationId);
  let paymentsQuery = supabase
    .from("payment_history")
    .select("amount_paid")
    .eq("organization_id", organizationId);
  let campaignsQuery = supabase
    .from("campaigns")
    .select("postgrid_tracker_id")
    .eq("organization_id", organizationId)
    .not("postgrid_tracker_id", "is", null);

  if (filters.campaign_ids) {
    postcardsQuery = postcardsQuery.in("campaign_id", filters.campaign_ids);
    paymentsQuery = paymentsQuery.in("campaign_id", filters.campaign_ids);
    campaignsQuery = campaignsQuery.in("id", filters.campaign_ids);
  }
  if (filters.since) {
    postcardsQuery = postcardsQuery.gte("created_at", filters.since);
    paymentsQuery = paymentsQuery.gte("created_at", filters.since);
  }

  const [postcardsResult, paymentsResult, campaignsResult] = await Promise.all([
    postcardsQuery,
    paymentsQuery,
    campaignsQuery,
  ]);

  if (postcardsResult.error) {
    console.error("Error fetching postcard_sends:", postcardsResult.error);
    throw new Error("Failed to fetch postcard data");
  }
  if (paymentsResult.error) {
    console.error("Error fetching payment_history:", paymentsResult.error);
    throw new Error("Failed to fetch payment data");
  }

  const postcards: Array<{ postgrid_status: string }> = postcardsResult.data ?? [];
  const payments: Array<{ amount_paid: number }> = paymentsResult.data ?? [];
  const campaignList: Array<{ postgrid_tracker_id: string }> = campaignsResult.data ?? [];

  let inFlight = 0;
  let delivered = 0;

  for (const p of postcards) {
    if (IN_FLIGHT_STATUSES.includes(p.postgrid_status)) {
      inFlight++;
    } else if (p.postgrid_status === "completed") {
      delivered++;
    }
  }

  const totalSent = postcards.length;
  const deliveryRate =
    totalSent > 0 ? Math.round((delivered / totalSent) * 10000) / 100 : 0;

  const spentToDate = payments.reduce(
    (sum, p) => sum + (Number(p.amount_paid) || 0),
    0,
  );
  const spentRounded = Math.round(spentToDate * 100) / 100;

  // Sum visitCount from each tracker's summary (all-time total scans)
  let totalScans = 0;
  if (postgridApiKey && campaignList.length > 0) {
    const scanCounts = await Promise.all(
      campaignList.map(async (c) => {
        try {
          const response = await fetch(
            `${POSTGRID_TRACKER_BASE_URL}/${c.postgrid_tracker_id}`,
            { headers: { "x-api-key": postgridApiKey } },
          );
          if (!response.ok) return 0;
          const data = await response.json();
          return data.visitCount ?? 0;
        } catch (err) {
          console.error(`[dashboard_cards] Failed for tracker ${c.postgrid_tracker_id}:`, err);
          return 0;
        }
      }),
    );
    totalScans = scanCounts.reduce((sum, n) => sum + n, 0);
  }

  return {
    in_flight_postcards: inFlight,
    delivered,
    delivery_rate: deliveryRate,
    total_scans: totalScans,
    spent_to_date: spentRounded,
    spent_to_date_display: enrichCurrency(spentRounded, preferences.currency ?? "USD"),
  };
}

/**
 * Compute Delivery Funnel Analytics
 *
 * Full PostGrid status breakdown expressed as percentages of total_postcards_sent.
 *
 * Two data sources from postcard_sends:
 *
 *   postgrid_status (standard lifecycle field — all orders):
 *     completed             → delivered
 *     processed_for_delivery→ processed
 *     printing              → printing
 *     ready                 → ready
 *     cancelled             → cancelled
 *
 *   imb_status (Intelligent-Mail Tracking — US only, nullable):
 *     entered_mail_stream   ┐
 *     out_for_delivery      ┘ both → in_transit (postcard is inside USPS network)
 *     returned_to_sender      → returned
 *
 * Note: imb_status fields will be 0 for non-US orders or before USPS first scans.
 * Percentages are rounded to 2 decimal places. All return 0 when total is 0.
 */
async function computeDeliveryFunnel(
  supabase: any,
  organizationId: string,
  filters: AnalyticsFilters,
): Promise<DeliveryFunnelData> {
  let query = supabase
    .from("postcard_sends")
    .select("postgrid_status, imb_status")
    .eq("organization_id", organizationId);
  if (filters.campaign_ids) query = query.in("campaign_id", filters.campaign_ids);
  if (filters.since) query = query.gte("created_at", filters.since);
  const { data: rows, error } = await query;

  if (error) {
    console.error("Error fetching postcard_sends for delivery funnel:", error);
    throw new Error("Failed to fetch postcard data");
  }

  const postcards: Array<{ postgrid_status: string; imb_status: string | null }> =
    rows ?? [];
  const total = postcards.length;

  // Count buckets from postgrid_status (standard field)
  const statusCounts: Record<string, number> = {
    completed: 0,
    processed_for_delivery: 0,
    printing: 0,
    ready: 0,
    cancelled: 0,
  };

  // Count buckets from imb_status (Intelligent-Mail Tracking, US only)
  const imbCounts: Record<string, number> = {
    entered_mail_stream: 0,
    out_for_delivery: 0,
    returned_to_sender: 0,
  };

  for (const p of postcards) {
    const s = p.postgrid_status;
    if (s in statusCounts) statusCounts[s]++;

    const imb = p.imb_status;
    if (imb && imb in imbCounts) imbCounts[imb]++;
  }

  const bucket = (count: number): FunnelBucket => ({
    count,
    percentage: total > 0 ? Math.round((count / total) * 10000) / 10000 : 0,
  });

  return {
    total_postcards_sent: total,
    // From postgrid_status
    delivered: bucket(statusCounts.completed),
    processed: bucket(statusCounts.processed_for_delivery),
    printing: bucket(statusCounts.printing),
    ready: bucket(statusCounts.ready),
    cancelled: bucket(statusCounts.cancelled),
    // From imb_status — both entered_mail_stream and out_for_delivery mean
    // the postcard is inside the USPS network (in transit toward the recipient)
    in_transit: bucket(imbCounts.entered_mail_stream + imbCounts.out_for_delivery),
    returned: bucket(imbCounts.returned_to_sender),
  };
}

// ---------------------------------------------------------------------------
// Waste Meter
// ---------------------------------------------------------------------------

/**
 * Counts working days (Mon–Fri) that have elapsed since a given date up to today.
 * A postcard is considered delayed if workingDaysSince(created_at) >= 7.
 *
 * Example: created Monday Jan 6 → 7th working day = Wednesday Jan 15.
 *          On Jan 15 the function returns 7 → delayed.
 */
function workingDaysSince(createdAt: Date): number {
  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  const cursor = new Date(createdAt);
  cursor.setHours(0, 0, 0, 0);

  let count = 0;
  while (cursor < todayMidnight) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay(); // 0 = Sunday, 6 = Saturday
    if (day !== 0 && day !== 6) {
      count++;
    }
  }
  return count;
}

/**
 * Determines the waste meter risk status from the problem rate.
 *
 * problem_rate = (total_pieces_wasted + total_pieces_delayed) / total_postcards_sent * 100
 *
 * Thresholds:
 *   < 5%   → Healthy   (low waste, delivery pipeline is performing well)
 *   5–15%  → At Risk   (moderate waste, worth monitoring)
 *   > 15%  → Critical  (high waste, requires attention)
 */
function resolveWasteStatus(
  piecesWasted: number,
  piecesDelayed: number,
  total: number,
): WasteMeterStatus {
  if (total === 0) return "Healthy";
  const problemRate = ((piecesWasted + piecesDelayed) / total) * 100;
  if (problemRate < WASTE_STATUS_THRESHOLDS.HEALTHY) return "Healthy";
  if (problemRate < WASTE_STATUS_THRESHOLDS.AT_RISK) return "At Risk";
  return "Critical";
}

/**
 * Compute Waste Meter Analytics
 *
 * Wasted postcard breakdown and dollar cost, plus a risk status indicator.
 *
 * Definitions:
 *   returned  — postcard has imbStatus = returned_to_sender (USPS returned it)
 *   cancelled — postcard has postgrid_status = cancelled (never printed/sent)
 *   wasted    — returned + cancelled (all money spent with no delivery)
 *   delayed   — postcard is not completed or cancelled AND >= 7 working days
 *               have passed since it was created (still no delivery confirmation)
 *
 * Dollar amounts use a fixed PRICE_PER_POSTCARD ($3.00 USD).
 * Status thresholds are based on (wasted + delayed) / total_sent.
 */
async function computeWasteMeter(
  supabase: any,
  organizationId: string,
  preferences: any,
  filters: AnalyticsFilters,
): Promise<WasteMeterData> {
  let query = supabase
    .from("postcard_sends")
    .select("postgrid_status, imb_status, created_at")
    .eq("organization_id", organizationId);
  if (filters.campaign_ids) query = query.in("campaign_id", filters.campaign_ids);
  if (filters.since) query = query.gte("created_at", filters.since);
  const { data: rows, error } = await query;

  if (error) {
    console.error("Error fetching postcard_sends for waste_meter:", error);
    throw new Error("Failed to fetch postcard data");
  }

  const postcards: Array<{
    postgrid_status: string;
    imb_status: string | null;
    created_at: string;
  }> = rows ?? [];

  const total = postcards.length;
  let piecesReturned = 0;
  let piecesCancelled = 0;
  let piecesDelayed = 0;

  for (const p of postcards) {
    // Returned: USPS gave it back (imbStatus)
    if (p.imb_status === "returned_to_sender") {
      piecesReturned++;
    }

    // Cancelled: never sent (postgrid_status)
    if (p.postgrid_status === "cancelled") {
      piecesCancelled++;
    }

    // Delayed: still active (not completed, not cancelled) but overdue
    if (p.postgrid_status !== "completed" && p.postgrid_status !== "cancelled") {
      const elapsed = workingDaysSince(new Date(p.created_at));
      if (elapsed >= 7) {
        piecesDelayed++;
      }
    }
  }

  const piecesWasted = piecesReturned + piecesCancelled;
  const usd = (pieces: number): number =>
    Math.round(pieces * PRICE_PER_POSTCARD * 100) / 100;

  return {
    status: resolveWasteStatus(piecesWasted, piecesDelayed, total),
    total_postcards_sent: total,
    total_pieces_wasted: piecesWasted,
    total_amount_wasted: usd(piecesWasted),
    total_pieces_returned: piecesReturned,
    total_amount_returned: usd(piecesReturned),
    total_pieces_cancelled: piecesCancelled,
    total_amount_cancelled: usd(piecesCancelled),
    total_pieces_delayed: piecesDelayed,
    total_amount_delayed: usd(piecesDelayed),
  };
}

// ---------------------------------------------------------------------------
// Scan Trend
// ---------------------------------------------------------------------------

const POSTGRID_TRACKER_BASE_URL = "https://api.postgrid.com/print-mail/v1/trackers";

// ---------------------------------------------------------------------------
// Simulated-data helpers
// Enabled per-organization via the ANALYTICS_SIMULATED_ORG_IDS secret
// (comma-separated org UUIDs). When an org is listed, the three scan-based
// analytics types return data derived from postcard_sends instead of calling
// the PostGrid tracker API — useful for demo accounts and seeded dev data.
// ---------------------------------------------------------------------------

/**
 * Returns true when the given org ID is in the ANALYTICS_SIMULATED_ORG_IDS
 * secret (comma-separated list of UUIDs).
 */
function _isSimulatedOrg(organizationId: string): boolean {
  const ids = (Deno.env.get("ANALYTICS_SIMULATED_ORG_IDS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(organizationId);
}

// ---------------------------------------------------------------------------
// Simulated Analytics
// ---------------------------------------------------------------------------

type SimBreakdownPeriod = "24h" | "week" | "month" | "alltime";

const SIM_HOUR_LABELS = ["12am","2am","4am","6am","8am","10am","12pm","2pm","4pm","6pm","8pm","10pm"];
const SIM_DAY_KEYS    = ["sunday_scans","monday_scans","tuesday_scans","wednesday_scans","thursday_scans","friday_scans","saturday_scans"];
const SIM_MONTH_ABBR  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function buildSimBreakdownTemplate(period: SimBreakdownPeriod): Record<string, number> {
  switch (period) {
    case "24h":
      return Object.fromEntries(SIM_HOUR_LABELS.map((k) => [k, 0]));
    case "week":
      return Object.fromEntries(SIM_DAY_KEYS.map((k) => [k, 0]));
    case "month": {
      const today = new Date();
      const start = new Date(today);
      start.setHours(0, 0, 0, 0);
      start.setDate(today.getDate() <= 15 ? 1 : today.getDate() - 14);
      const result: Record<string, number> = {};
      const cur = new Date(start);
      const end = new Date(today);
      end.setHours(23, 59, 59, 999);
      while (cur <= end) {
        result[`${SIM_MONTH_ABBR[cur.getMonth()]} ${cur.getDate()}`] = 0;
        cur.setDate(cur.getDate() + 1);
      }
      return result;
    }
    case "alltime": {
      const today = new Date();
      const result: Record<string, number> = {};
      for (let i = 5; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        result[`${SIM_MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`] = 0;
      }
      return result;
    }
  }
}

function buildSimulatedAnalytics(analyticsType: string, filters: AnalyticsFilters): unknown | null {
  // Scale by time window: all_time=1.0, last_month=0.60, last_week=0.20, last_24hours=0.03
  let scale = 1.0;
  if (filters.since) {
    const ageDays = (Date.now() - new Date(filters.since).getTime()) / 86_400_000;
    scale = ageDays <= 1.1 ? 0.03 : ageDays <= 8 ? 0.20 : 0.60;
  }

  // ── Postcard counts (all derived from one scaled total) ───────────────────
  const total     = Math.max(1, Math.round(1254 * scale));
  const completed = Math.round(1189 / 1254 * total);
  const processed = Math.round(  17 / 1254 * total);
  const printing  = Math.round(  18 / 1254 * total);
  const cancelled = Math.round(  18 / 1254 * total);
  const ready     = total - completed - processed - printing - cancelled;
  const inFlight  = processed + printing + ready;
  const inTransit = Math.round(187 / 1254 * total);
  const returned  = Math.round(  7 / 1254 * total);
  const delayed   = Math.round(  4 / 1254 * total);
  const wasted    = returned + cancelled;
  const deliveryRate = Math.round(completed / total * 10000) / 100;
  const spentToDate  = Math.round(total * PRICE_PER_POSTCARD * 100) / 100;
  const usd          = (n: number) => Math.round(n * PRICE_PER_POSTCARD * 100) / 100;
  const problemRate  = ((wasted + delayed) / total) * 100;
  const wasteStatus: WasteMeterStatus =
    problemRate < WASTE_STATUS_THRESHOLDS.HEALTHY ? "Healthy"
    : problemRate < WASTE_STATUS_THRESHOLDS.AT_RISK ? "At Risk"
    : "Critical";

  // ── Campaign data ─────────────────────────────────────────────────────────
  const CAMPAIGN_NAMES      = ["Spring Neighborhood Outreach","East Side Growth Drive","Downtown Business Promo","North County Expansion","Summer Referral Wave"];
  const BASE_CAMPAIGN_POSTS = [480, 312, 256, 154, 52];
  const BASE_SCAN_RATES     = [29.58, 31.41, 23.83, 22.08, 13.46];

  const scaledPosts = BASE_CAMPAIGN_POSTS.map((p) => Math.round(p / 1254 * total));
  scaledPosts[4] = total - scaledPosts[0] - scaledPosts[1] - scaledPosts[2] - scaledPosts[3];
  const scaledScans = scaledPosts.map((p, i) => Math.max(0, Math.round(p * BASE_SCAN_RATES[i] / 100)));
  const totalScans  = scaledScans.reduce((a, b) => a + b, 0);
  const uniqueScans = Math.round(totalScans * 0.845);

  const bucket = (count: number) => ({
    count,
    percentage: total > 0 ? Math.round((count / total) * 10000) / 10000 : 0,
  });

  switch (analyticsType) {
    case "dashboard_cards":
      return {
        in_flight_postcards:   inFlight,
        delivered:             completed,
        delivery_rate:         deliveryRate,
        total_scans:           totalScans,
        spent_to_date:         spentToDate,
        spent_to_date_display: enrichCurrency(spentToDate, "USD"),
      };

    case "delivery_funnel":
      return {
        total_postcards_sent: total,
        delivered:  bucket(completed),
        processed:  bucket(processed),
        printing:   bucket(printing),
        ready:      bucket(ready),
        cancelled:  bucket(cancelled),
        in_transit: bucket(inTransit),
        returned:   bucket(returned),
      };

    case "waste_meter":
      return {
        status:                 wasteStatus,
        total_postcards_sent:   total,
        total_pieces_wasted:    wasted,
        total_amount_wasted:    usd(wasted),
        total_pieces_returned:  returned,
        total_amount_returned:  usd(returned),
        total_pieces_cancelled: cancelled,
        total_amount_cancelled: usd(cancelled),
        total_pieces_delayed:   delayed,
        total_amount_delayed:   usd(delayed),
      };

    case "scan_trend": {
      const period: SimBreakdownPeriod =
        scale <= 0.03 ? "24h" : scale <= 0.20 ? "week" : scale < 1.0 ? "month" : "alltime";
      const tpl = buildSimBreakdownTemplate(period);
      let rawWeights: number[];
      if (period === "24h") {
        rawWeights = [0, 3, 0, 1, 12, 9, 14, 8, 6, 4, 2, 1];
      } else if (period === "week") {
        rawWeights = [11, 68, 54, 61, 57, 72, 19];
      } else if (period === "month") {
        const DOW_WEIGHTS = [1, 7, 6, 8, 6, 9, 2];
        rawWeights = Object.keys(tpl).map((k) => {
          const d = new Date();
          d.setDate(parseInt(k.split(" ")[1], 10));
          return DOW_WEIGHTS[d.getDay()];
        });
      } else {
        rawWeights = [34, 51, 28, 67, 89, 73];
      }
      const rawSum = rawWeights.reduce((a, b) => a + b, 0);
      const keys   = Object.keys(tpl);
      let remaining = totalScans;
      keys.forEach((k, i) => {
        if (i === keys.length - 1) {
          tpl[k] = Math.max(0, remaining);
        } else {
          const v = rawSum > 0 ? Math.max(0, Math.round(rawWeights[i] / rawSum * totalScans)) : 0;
          tpl[k] = v;
          remaining -= v;
        }
      });
      return { total_scans: totalScans, unique_scans: uniqueScans, scan_rate: total > 0 ? Math.round(totalScans / total * 10000) / 100 : 0, breakdown: tpl };
    }

    case "recent_scans": {
      const allCampaigns = [
        {
          campaign_id: "sim-campaign-001", campaign_name: "Spring Neighborhood Outreach",
          scans: [
            { postcard_number: 84,  scan_address: "2741 Market St, San Francisco, CA",  scan_time_stamp: "3 minutes ago" },
            { postcard_number: 201, scan_address: "490 Post St, San Francisco, CA",      scan_time_stamp: "18 minutes ago" },
            { postcard_number: 57,  scan_address: "1 Ferry Building, San Francisco, CA", scan_time_stamp: "41 minutes ago" },
            { postcard_number: 133, scan_address: "3650 21st St, San Francisco, CA",     scan_time_stamp: "2 hours ago" },
            { postcard_number: 76,  scan_address: "720 Valencia St, San Francisco, CA",  scan_time_stamp: "4 hours ago" },
          ],
        },
        {
          campaign_id: "sim-campaign-002", campaign_name: "East Side Growth Drive",
          scans: [
            { postcard_number: 38,  scan_address: "4601 E Thomas Rd, Phoenix, AZ",       scan_time_stamp: "7 minutes ago" },
            { postcard_number: 112, scan_address: "2022 E McDowell Rd, Phoenix, AZ",     scan_time_stamp: "1 hour ago" },
            { postcard_number: 9,   scan_address: "6900 E Camelback Rd, Scottsdale, AZ", scan_time_stamp: "3 hours ago" },
            { postcard_number: 67,  scan_address: "7014 E Camelback Rd, Scottsdale, AZ", scan_time_stamp: "5 hours ago" },
          ],
        },
        {
          campaign_id: "sim-campaign-003", campaign_name: "Downtown Business Promo",
          scans: [
            { postcard_number: 22, scan_address: "233 S Wacker Dr, Chicago, IL",    scan_time_stamp: "34 minutes ago" },
            { postcard_number: 45, scan_address: "875 N Michigan Ave, Chicago, IL", scan_time_stamp: "2 hours ago" },
            { postcard_number: 61, scan_address: "151 N Michigan Ave, Chicago, IL", scan_time_stamp: "6 hours ago" },
          ],
        },
      ];
      const campaignLimit = scale <= 0.03 ? 1 : scale <= 0.20 ? 2 : 3;
      const scanLimit     = scale <= 0.03 ? 2 : scale <= 0.20 ? 3 : 5;
      return { data: allCampaigns.slice(0, campaignLimit).map((c) => ({ ...c, scans: c.scans.slice(0, scanLimit) })) };
    }

    case "campaign_leaderboard": {
      const leaderboard = CAMPAIGN_NAMES
        .map((name, i) => ({ campaign_name: name, total_scans: scaledScans[i], total_postcards_sent: scaledPosts[i], scan_rate: BASE_SCAN_RATES[i] }))
        .filter((e) => e.total_scans > 0)
        .map((e, i) => ({ ...e, ranking_position: i + 1 }));
      return { leaderboard };
    }

    case "campaign_performance": {
      const ranked = CAMPAIGN_NAMES.map((name, i) => ({
        campaign_name: name, total_scans: scaledScans[i], total_postcards_sent: scaledPosts[i],
        scan_rate: BASE_SCAN_RATES[i], ranking_position: i + 1,
      }));
      return { top_performers: ranked, bottom_performers: [] };
    }

    case "postcard_overview": {
      const campaign_summary = CAMPAIGN_NAMES.map((name, i) => {
        const posts    = scaledPosts[i];
        const delivered = Math.round(posts * 1189 / 1254);
        const dasScans  = Math.min(scaledScans[i], delivered);
        return {
          campaign_id: `sim-campaign-00${i + 1}`, campaign_name: name,
          total_postcards_sent:      posts,
          delivered_and_scanned:     dasScans,
          delivered_but_not_scanned: Math.max(0, delivered - dasScans),
          in_transit:                Math.round(posts * 47 / 1254),
          returned_cancelled:        Math.round(posts * 25 / 1254),
        };
      });
      const sum = (key: keyof typeof campaign_summary[0]) =>
        campaign_summary.reduce((a, c) => a + (c[key] as number), 0);
      return {
        total_summary: {
          delivered_and_scanned:     sum("delivered_and_scanned"),
          delivered_but_not_scanned: sum("delivered_but_not_scanned"),
          in_transit:                sum("in_transit"),
          returned_cancelled:        sum("returned_cancelled"),
        },
        campaign_summary,
      };
    }

    case "active_campaigns": {
      const SIM_ACTIVE = [
        { idx: 0, days_running: 42, dr: 0.9488, status: "On Track" },
        { idx: 1, days_running: 18, dr: 0.7200, status: "Delayed"  },
        { idx: 2, days_running:  7, dr: 0.4500, status: "At Risk"  },
      ];
      return SIM_ACTIVE.map(({ idx, days_running, dr, status }) => ({
        campaign_id:   `sim-campaign-00${idx + 1}`,
        campaign_name: CAMPAIGN_NAMES[idx],
        days_running,
        in_flight:     Math.max(0, Math.round(scaledPosts[idx] * 47 / 1254)),
        scans:         scaledScans[idx],
        delivery_rate: dr,
        status,
      }));
    }

    case "performance_trend": {
      const SIM_PERF_DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const DR_PAT  = [0.82, 0.91, 0.89, 0.93, 0.87, 0.90, 0.84];
      const SR_PAT  = [0.02, 0.05, 0.04, 0.06, 0.04, 0.05, 0.03];
      const VOL_PAT = [3, 8, 7, 9, 7, 8, 4];
      const nowPT = new Date();
      const allDaysPT = Array.from({ length: 180 }, (_, i) => {
        const d = new Date(nowPT);
        d.setUTCDate(nowPT.getUTCDate() - 179 + i);
        const dow = d.getUTCDay();
        return {
          date: d.toISOString().slice(0, 10), day: SIM_PERF_DAY_NAMES[dow],
          delivery_rate: DR_PAT[dow], scan_rate: SR_PAT[dow],
          total_volume: Math.max(0, Math.round(total * VOL_PAT[dow] / (6 * 180))),
        };
      });
      if (scale <= 0.03) return allDaysPT.slice(-1);
      if (scale <= 0.20) return allDaysPT.slice(-7);
      if (scale  < 1.0) {
        const firstOfMonth = new Date(nowPT.getUTCFullYear(), nowPT.getUTCMonth(), 1);
        const daysSinceFirst = Math.floor((nowPT.getTime() - firstOfMonth.getTime()) / 86_400_000);
        return allDaysPT.slice(179 - daysSinceFirst);
      }
      return allDaysPT;
    }

    case "scan_trend_by_type": {
      const SIM_TYPE_DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const lzPosts  = scaledPosts[0] + scaledPosts[1];
      const refPosts = scaledPosts[2] + scaledPosts[3];
      const alPosts  = scaledPosts[4];
      const VOL_PAT_TYPE = [2, 6, 5, 7, 5, 6, 3];
      const nowST = new Date();
      const allDaysST = Array.from({ length: 180 }, (_, i) => {
        const d = new Date(nowST);
        d.setUTCDate(nowST.getUTCDate() - 179 + i);
        const dow = d.getUTCDay();
        const daily = Math.max(0, Math.round(totalScans * VOL_PAT_TYPE[dow] / (4.9 * 180)));
        const lz    = Math.round(daily * 0.55);
        const ref   = Math.round(daily * 0.30);
        const al    = daily - lz - ref;
        return {
          date: d.toISOString().slice(0, 10), day: SIM_TYPE_DAY_NAMES[dow],
          total_scans: daily,
          location_zone:  { count: lz,  percentage: lzPosts  > 0 ? Math.round(lz  / lzPosts  * 10000) / 10000 : 0 },
          referral:       { count: ref, percentage: refPosts > 0 ? Math.round(ref / refPosts * 10000) / 10000 : 0 },
          addresses_list: { count: al,  percentage: alPosts  > 0 ? Math.round(al  / alPosts  * 10000) / 10000 : 0 },
        };
      });
      if (scale <= 0.03) return allDaysST.slice(-1);
      if (scale <= 0.20) return allDaysST.slice(-7);
      if (scale  < 1.0) {
        const firstOfMonth = new Date(nowST.getUTCFullYear(), nowST.getUTCMonth(), 1);
        const daysSinceFirst = Math.floor((nowST.getTime() - firstOfMonth.getTime()) / 86_400_000);
        return allDaysST.slice(179 - daysSinceFirst);
      }
      return allDaysST;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Scan trend breakdown helpers
// ---------------------------------------------------------------------------

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Maps a 0-23 hour value to its 2-hour slot label (e.g. 14 → "2pm"). */
function hourSlotKey(hour: number): string {
  const slot = Math.floor(hour / 2) * 2;
  if (slot === 0) return "12am";
  if (slot === 12) return "12pm";
  return slot < 12 ? `${slot}am` : `${slot - 12}pm`;
}

function formatDayLabel(d: Date): string {
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function formatMonthLabel(d: Date): string {
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Builds a zeroed breakdown Record for the given period.
 *
 * last_24hours → 12 two-hour slot keys  (12am … 10pm)
 * last_week    → 7 weekday keys          (monday_scans … sunday_scans)
 * last_month   → daily keys for either:
 *                  day 1–15  →  1st of current month … today
 *                  day 16+   →  today-14 … today
 * all_time     → 6 monthly keys          (e.g. "Nov 2025" … "Apr 2026")
 */
function buildBreakdown(visits: Array<{ ts: string }>, period: "last_24hours"): ScanTrendBreakdown24Hours;
function buildBreakdown(visits: Array<{ ts: string }>, period: "last_week"): ScanTrendBreakdownLastWeek;
function buildBreakdown(visits: Array<{ ts: string }>, period: "last_month"): ScanTrendBreakdownLastMonth;
function buildBreakdown(visits: Array<{ ts: string }>, period: "all_time"): ScanTrendBreakdownAllTime;
function buildBreakdown(visits: Array<{ ts: string }>, period: ScanPeriod): ScanTrendBreakdown24Hours | ScanTrendBreakdownLastWeek | ScanTrendBreakdownLastMonth | ScanTrendBreakdownAllTime;
function buildBreakdown(
  visits: Array<{ ts: string }>,
  period: ScanPeriod,
): ScanTrendBreakdown24Hours | ScanTrendBreakdownLastWeek | ScanTrendBreakdownLastMonth | ScanTrendBreakdownAllTime {
  if (period === "last_24hours") {
    const buckets: ScanTrendBreakdown24Hours = { "12am": 0, "2am": 0, "4am": 0, "6am": 0, "8am": 0, "10am": 0, "12pm": 0, "2pm": 0, "4pm": 0, "6pm": 0, "8pm": 0, "10pm": 0 };
    for (const { ts } of visits) {
      const key = hourSlotKey(new Date(ts).getHours()) as keyof ScanTrendBreakdown24Hours;
      if (key in buckets) buckets[key]++;
    }
    return buckets;
  }

  if (period === "last_week") {
    const buckets: ScanTrendBreakdownLastWeek = { sunday_scans: 0, monday_scans: 0, tuesday_scans: 0, wednesday_scans: 0, thursday_scans: 0, friday_scans: 0, saturday_scans: 0 };
    const DOW: Array<keyof ScanTrendBreakdownLastWeek> = ["sunday_scans","monday_scans","tuesday_scans","wednesday_scans","thursday_scans","friday_scans","saturday_scans"];
    for (const { ts } of visits) {
      buckets[DOW[new Date(ts).getDay()]]++;
    }
    return buckets;
  }

  if (period === "last_month") {
    const now = new Date();
    const start = new Date(now);
    if (now.getDate() <= 15) {
      start.setDate(1);
    } else {
      start.setDate(start.getDate() - 14);
    }
    start.setHours(0, 0, 0, 0);

    const buckets: ScanTrendBreakdownLastMonth = {};
    const cursor = new Date(start);
    while (cursor <= now) {
      buckets[formatDayLabel(cursor)] = 0;
      cursor.setDate(cursor.getDate() + 1);
    }
    for (const { ts } of visits) {
      const key = formatDayLabel(new Date(ts));
      if (key in buckets) buckets[key]++;
    }
    return buckets;
  }

  // all_time — last 6 full months
  const now = new Date();
  const buckets: Record<string, number> = {};
  for (let i = 5; i >= 0; i--) {
    buckets[formatMonthLabel(new Date(now.getFullYear(), now.getMonth() - i, 1))] = 0;
  }
  for (const { ts } of visits) {
    const key = formatMonthLabel(new Date(ts));
    if (key in buckets) buckets[key]++;
  }
  return buckets;
}

/**
 * Generates fake tracker_visit objects that mirror the PostGrid
 * GET /trackers/{id}/visits response shape, then processes them
 * through the same filtering + buildBreakdown logic as the real path.
 */
function _simulateScanTrend(
  totalPostcardsSent: number,
  period: ScanPeriod,
  since?: string,
  postcardIds: string[] = [],
): ScanTrendData {
  if (totalPostcardsSent === 0) {
    return { total_scans: 0, unique_scans: 0, scan_rate: 0, breakdown: buildBreakdown([], period) };
  }

  // Generate ~13% scan rate worth of fake visits spread across last 6 months
  const visitCount = Math.floor(totalPostcardsSent * 0.13);
  const now = Date.now();
  const sixMonthsMs = 180 * 24 * 60 * 60 * 1000;

  // Hour-of-day weights (afternoon peak) — used to bias visit timestamps
  const hourWeights = [0.01,0.01,0.005,0.005,0.01,0.02,0.04,0.07,0.09,0.10,0.10,0.11,0.11,0.10,0.09,0.08,0.06,0.05,0.04,0.03,0.02,0.015,0.01,0.005];
  const hourCdf: number[] = [];
  hourWeights.reduce((acc, w, i) => { hourCdf[i] = acc + w; return hourCdf[i]; }, 0);

  function pickHour(): number {
    const r = Math.random();
    return hourCdf.findIndex((c) => r <= c);
  }

  // Generate fake visits with realistic createdAt spread over last 6 months
  const fakeVisits = Array.from({ length: visitCount }, (_, i) => {
    const msAgo = Math.floor(Math.random() * sixMonthsMs);
    const visitDate = new Date(now - msAgo);
    visitDate.setHours(pickHour(), Math.floor(Math.random() * 60), 0, 0);
    const orderId = postcardIds.length > 0
      ? postcardIds[i % postcardIds.length]
      : `postcard_sim_${i % Math.max(Math.floor(totalPostcardsSent * 0.78), 1)}`;
    return {
      id: `tracker_visit_sim_${i}`,
      object: "tracker_visit",
      live: false,
      orderID: orderId,
      createdAt: visitDate.toISOString(),
    };
  });

  // Apply the same time filter the real path uses
  const filtered = since
    ? fakeVisits.filter((v) => v.createdAt >= since)
    : fakeVisits;

  const totalScans = filtered.length;
  const seenOrders = new Set(filtered.map((v) => v.orderID));
  const uniqueScans = seenOrders.size;
  const scanRate =
    totalPostcardsSent > 0
      ? Math.round((totalScans / totalPostcardsSent) * 10000) / 100
      : 0;

  // For all_time, totals come from the full set (mirrors tracker summary visitCount)
  const allTimeTotalScans = period === "all_time" ? visitCount : totalScans;
  const allTimeUniqueScans = period === "all_time"
    ? new Set(fakeVisits.map((v) => v.orderID)).size
    : uniqueScans;

  const visits = period === "all_time" ? fakeVisits : filtered;

  return {
    total_scans: allTimeTotalScans,
    unique_scans: allTimeUniqueScans,
    scan_rate: period === "all_time"
      ? Math.round((allTimeTotalScans / totalPostcardsSent) * 10000) / 100
      : scanRate,
    breakdown: buildBreakdown(visits.map((v) => ({ ts: v.createdAt })), period),
  };
}

/** Simulates recent_scans data from the postcard_sends already in the DB. */
function _simulateRecentScans(
  campaigns: Array<{ id: string; campaign_name: string; postgrid_tracker_id: string }>,
  sends: Array<{ postgrid_postcard_id: string; campaign_id: string; address: string | null; created_at: string }>,
  since?: string,
): RecentScansData {
  const sendsByCampaign = new Map<string, typeof sends>();
  for (const s of sends) {
    if (!sendsByCampaign.has(s.campaign_id)) sendsByCampaign.set(s.campaign_id, []);
    sendsByCampaign.get(s.campaign_id)!.push(s);
  }

  const result: CampaignRecentScans[] = [];
  for (const campaign of campaigns) {
    const campaignSends = (sendsByCampaign.get(campaign.id) ?? [])
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, RECENT_SCANS_LIMIT);

    if (campaignSends.length === 0) continue;

    const scans: RecentScanEvent[] = campaignSends.map((s, idx) => {
      // Spread simulated scan times evenly over the last 48 hours
      const fakeTs = new Date(Date.now() - (idx + 1) * 8 * 60 * 60 * 1000).toISOString();
      if (since && fakeTs < since) return null;
      return {
        postcard_number: idx + 1,
        scan_address: s.address ?? "Unknown",
        scan_time_stamp: timeAgo(fakeTs),
      };
    }).filter(Boolean) as RecentScanEvent[];

    if (scans.length > 0) {
      result.push({ campaign_id: campaign.id, campaign_name: campaign.campaign_name, scans });
    }
  }
  return { data: result };
}

/** Simulates campaign_leaderboard data from campaigns.postcards_sent. */
function _simulateCampaignLeaderboard(
  campaigns: Array<{ id: string; campaign_name: string; postgrid_tracker_id: string; postcards_sent: number | null }>,
): CampaignLeaderboardData {
  const entries = campaigns
    .map((c) => {
      const sent = c.postcards_sent ?? 0;
      if (sent === 0) return null;
      const totalScans = Math.floor(sent * 0.13);
      if (totalScans === 0) return null;
      return {
        campaign_name: c.campaign_name,
        total_scans: totalScans,
        total_postcards_sent: sent,
        scan_rate: Math.round((totalScans / sent) * 10000) / 100,
      };
    })
    .filter(Boolean) as Array<Omit<LeaderboardEntry, "ranking_position">>;

  const leaderboard: LeaderboardEntry[] = entries
    .sort((a, b) => b.total_scans - a.total_scans)
    .slice(0, LEADERBOARD_SIZE)
    .map((entry, idx) => ({ ...entry, ranking_position: idx + 1 }));

  return { leaderboard };
}

/**
 * Compute Scan Trend Analytics
 *
 * Aggregates QR code scan data across all campaigns in the organization
 * that have a PostGrid tracker linked via linkQRCodeToCampaign.
 *
 * Data sources:
 * - campaigns.postgrid_tracker_id → tracker IDs to query
 * - PostGrid GET /print-mail/v1/trackers/{id}
 *     visitCount         → total_scans (summed across all org trackers)
 *     uniqueVisitCount   → unique_scans (summed across all org trackers)
 *     clicks[].createdAt → day-of-week breakdown
 * - postcard_sends COUNT → total_postcards_sent (denominator for scan_rate)
 *
 * scan_rate = (total_scans / total_postcards_sent) * 100, rounded to 2dp.
 * breakdown counts all historical clicks by the weekday they occurred.
 * Returns all zeros when no trackers are linked or no scans have occurred yet.
 */
async function computeScanTrend(
  supabase: any,
  organizationId: string,
  filters: AnalyticsFilters,
): Promise<ScanTrendData> {
  const postgridApiKey =
    Deno.env.get("POSTGRID_POSTCARD_API_KEY") ??
    Deno.env.get("VITE_POSTGRID_POSTCARD_API_KEY");

  // Scope campaigns to a specific one if campaign_id filter provided
  let campaignsQuery = supabase
    .from("campaigns")
    .select("id, postgrid_tracker_id")
    .eq("organization_id", organizationId)
    .not("postgrid_tracker_id", "is", null);
  if (filters.campaign_ids) campaignsQuery = campaignsQuery.in("id", filters.campaign_ids);

  // Total postcards denominator also respects campaign_ids filter
  let postcardsQuery = supabase
    .from("postcard_sends")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (filters.campaign_ids) postcardsQuery = postcardsQuery.in("campaign_id", filters.campaign_ids);

  const [campaignsResult, postcardsResult] = await Promise.all([
    campaignsQuery,
    postcardsQuery,
  ]);

  if (campaignsResult.error) {
    console.error("Error fetching campaigns for scan_trend:", campaignsResult.error);
    throw new Error("Failed to fetch campaign data");
  }

  const campaigns: Array<{ id: string; postgrid_tracker_id: string }> =
    campaignsResult.data ?? [];
  const totalPostcardsSent: number = postcardsResult.count ?? 0;

  if (campaigns.length === 0 || !postgridApiKey) {
    return { total_scans: 0, unique_scans: 0, scan_rate: 0, breakdown: buildBreakdown([], filters.period) };
  }

  // if (isSimulatedOrg(organizationId)) {
  //   return simulateScanTrend(totalPostcardsSent, filters.period, filters.since);
  // }

  const allVisits: Array<{ ts: string }> = [];
  let totalScans = 0;
  let uniqueScans = 0;

  if (filters.period === "all_time") {
    // Use tracker summary for accurate aggregate totals; /visits for monthly breakdown.
    await Promise.all(
      campaigns.map(async (campaign) => {
        try {
          const [summaryRes, visitsRes] = await Promise.all([
            fetch(`${POSTGRID_TRACKER_BASE_URL}/${campaign.postgrid_tracker_id}`, {
              headers: { "x-api-key": postgridApiKey },
            }),
            fetch(`${POSTGRID_TRACKER_BASE_URL}/${campaign.postgrid_tracker_id}/visits?limit=1000&skip=0`, {
              headers: { "x-api-key": postgridApiKey },
            }),
          ]);
          if (!summaryRes.ok) {
            console.warn(`[scan_trend] PostGrid ${summaryRes.status} for tracker ${campaign.postgrid_tracker_id}`);
            return;
          }
          const summary = await summaryRes.json();
          totalScans += summary.visitCount ?? 0;
          uniqueScans += summary.uniqueVisitCount ?? 0;
          if (visitsRes.ok) {
            const result = await visitsRes.json();
            const visits: Array<Record<string, unknown>> = Array.isArray(result.data)
              ? (result.data as Array<Record<string, unknown>>)
              : Array.isArray(result)
              ? (result as Array<Record<string, unknown>>)
              : [];
            for (const v of visits) {
              const ts = (v.createdAt ?? v.created_at) as string | undefined;
              if (ts) allVisits.push({ ts });
            }
          }
        } catch (err) {
          console.error(`[scan_trend] Failed for tracker ${campaign.postgrid_tracker_id}:`, err);
        }
      }),
    );
  } else {
    // Filtered paths (last_24hours, last_week, last_month): use /visits with since filter.
    await Promise.all(
      campaigns.map(async (campaign) => {
        try {
          const response = await fetch(
            `${POSTGRID_TRACKER_BASE_URL}/${campaign.postgrid_tracker_id}/visits?limit=1000&skip=0`,
            { headers: { "x-api-key": postgridApiKey } },
          );
          if (!response.ok) return;
          const result = await response.json();
          const visits: Array<Record<string, unknown>> = Array.isArray(result.data)
            ? (result.data as Array<Record<string, unknown>>)
            : Array.isArray(result)
            ? (result as Array<Record<string, unknown>>)
            : [];

          const filtered = visits.filter((v) => {
            const ts = (v.createdAt ?? v.created_at) as string | undefined;
            return ts && ts >= filters.since!;
          });

          totalScans += filtered.length;

          const seenOrders = new Set<string>();
          for (const v of filtered) {
            const ts = (v.createdAt ?? v.created_at) as string | undefined;
            const oid = (v.orderID ?? v.orderId ?? v.order_id) as string | undefined;
            if (ts) allVisits.push({ ts });
            if (oid) seenOrders.add(oid);
          }
          uniqueScans += seenOrders.size;
        } catch (err) {
          console.error(`[scan_trend] Failed for tracker ${campaign.postgrid_tracker_id}:`, err);
        }
      }),
    );
  }

  const scanRate =
    totalPostcardsSent > 0
      ? Math.round((totalScans / totalPostcardsSent) * 10000) / 100
      : 0;

  return {
    total_scans: totalScans,
    unique_scans: uniqueScans,
    scan_rate: scanRate,
    breakdown: buildBreakdown(allVisits, filters.period),
  };
}

// ---------------------------------------------------------------------------
// Recent Scans
// ---------------------------------------------------------------------------

// Max scan events fetched from PostGrid per tracker (most recent first)
const RECENT_SCANS_LIMIT = 10;

/**
 * Converts an ISO timestamp to a human-readable relative string.
 * e.g. "just now", "5 minutes ago", "2 hours ago", "3 days ago"
 */
function timeAgo(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

/**
 * Compute Recent Scans Analytics
 *
 * Returns the most recent QR code scan events per campaign for this organization.
 * Each scan is enriched with the delivery address and a human-readable timestamp.
 *
 * Data flow:
 * 1. Fetch campaigns with postgrid_tracker_id from DB
 * 2. Fetch all postcard_sends for the org → build two lookup maps:
 *      postgrid_postcard_id → delivery address
 *      postgrid_postcard_id → sequential postcard number within that campaign
 * 3. For each campaign, call PostGrid GET /trackers/{id}/visits (up to RECENT_SCANS_LIMIT)
 * 4. Join each visit's orderId to the postcard_sends lookup
 *      scan_address    = postcard_sends.address (the household the card was mailed to)
 *      postcard_number = sequential row number within the campaign (ordered by created_at)
 *      scan_time_stamp = timeAgo(visit.createdAt)
 * 5. Only include campaigns that have at least one scan
 * 6. Sort campaigns by most recent scan descending
 */
async function computeRecentScans(
  supabase: any,
  organizationId: string,
  filters: AnalyticsFilters,
): Promise<RecentScansData> {
  const postgridApiKey =
    Deno.env.get("POSTGRID_POSTCARD_API_KEY") ??
    Deno.env.get("VITE_POSTGRID_POSTCARD_API_KEY");

  // 1. Fetch campaigns with trackers (scope to campaign_id if provided)
  let campaignsQuery = supabase
    .from("campaigns")
    .select("id, campaign_name, postgrid_tracker_id")
    .eq("organization_id", organizationId)
    .not("postgrid_tracker_id", "is", null);
  if (filters.campaign_ids) campaignsQuery = campaignsQuery.in("id", filters.campaign_ids);
  const { data: campaigns, error: campaignsError } = await campaignsQuery;

  if (campaignsError) {
    console.error("Error fetching campaigns for recent_scans:", campaignsError);
    throw new Error("Failed to fetch campaign data");
  }

  const campaignList: Array<{
    id: string;
    campaign_name: string;
    postgrid_tracker_id: string;
  }> = campaigns ?? [];

  if (campaignList.length === 0 || !postgridApiKey) {
    return { data: [] };
  }

  // 2. Fetch postcard_sends for address/number lookup — scope to campaign if filtered
  let sendsQuery = supabase
    .from("postcard_sends")
    .select("postgrid_postcard_id, campaign_id, address, created_at")
    .eq("organization_id", organizationId)
    .order("campaign_id", { ascending: true })
    .order("created_at", { ascending: true });
  if (filters.campaign_ids) sendsQuery = sendsQuery.in("campaign_id", filters.campaign_ids);
  const { data: sends, error: sendsError } = await sendsQuery;

  if (sendsError) {
    console.error("Error fetching postcard_sends for recent_scans:", sendsError);
    throw new Error("Failed to fetch postcard data");
  }

  // postcardId → delivery address
  const addressMap = new Map<string, string>();
  // postcardId → sequential number within campaign (1-based)
  const numberMap = new Map<string, number>();
  const campaignCounters = new Map<string, number>();

  for (const row of sends ?? []) {
    const n = (campaignCounters.get(row.campaign_id) ?? 0) + 1;
    campaignCounters.set(row.campaign_id, n);
    numberMap.set(row.postgrid_postcard_id, n);
    if (row.address) addressMap.set(row.postgrid_postcard_id, row.address);
  }

  // if (isSimulatedOrg(organizationId)) {
  //   return simulateRecentScans(campaignList, sends ?? [], filters.since);
  // }

  // 3. Fetch visits from PostGrid for each campaign in parallel
  const campaignScans: CampaignRecentScans[] = [];

  await Promise.all(
    campaignList.map(async (campaign) => {
      try {
        const response = await fetch(
          `${POSTGRID_TRACKER_BASE_URL}/${campaign.postgrid_tracker_id}/visits?limit=${RECENT_SCANS_LIMIT}&skip=0`,
          { headers: { "x-api-key": postgridApiKey } },
        );

        if (!response.ok) {
          console.warn(
            `[recent_scans] PostGrid ${response.status} for tracker ${campaign.postgrid_tracker_id}`,
          );
          return;
        }

        const result = await response.json();
        // PostGrid list responses wrap items in a `data` array
        let visits: Array<Record<string, any>> = Array.isArray(result.data)
          ? result.data
          : Array.isArray(result)
          ? result
          : [];

        // Apply time filter if provided
        if (filters.since) {
          visits = visits.filter((v) => {
            const ts = v.createdAt ?? v.created_at;
            return ts && ts >= filters.since!;
          });
        }

        if (visits.length === 0) return;

        const scans: RecentScanEvent[] = visits.map((visit, index) => {
          const orderId: string | undefined = visit.orderId ?? visit.order_id ?? visit.order;
          const ts: string = visit.createdAt ?? visit.created_at ?? "";

          // Postcard number from our DB lookup, fallback to visit index
          const postcardNumber = orderId
            ? (numberMap.get(orderId) ?? index + 1)
            : index + 1;

          // Delivery address from our DB, fallback to any geo PostGrid provides
          const address = (orderId && addressMap.get(orderId))
            ?? [visit.city, visit.region ?? visit.state]
              .filter(Boolean)
              .join(", ")
            ?? "Unknown";

          return {
            postcard_number: postcardNumber,
            scan_address: address,
            scan_time_stamp: ts ? timeAgo(ts) : "Unknown",
          };
        });

        campaignScans.push({
          campaign_id: campaign.id,
          campaign_name: campaign.campaign_name,
          scans,
        });
      } catch (err) {
        console.error(
          `[recent_scans] Failed for tracker ${campaign.postgrid_tracker_id}:`,
          err,
        );
      }
    }),
  );

  // Sort campaigns: most recent scan first (visits are already ordered by PostGrid descending)
  campaignScans.sort((a, b) => b.scans.length - a.scans.length);

  return { data: campaignScans };
}

// ---------------------------------------------------------------------------
// Campaign Leaderboard
// ---------------------------------------------------------------------------

const LEADERBOARD_SIZE = 5;

/**
 * Compute Campaign Leaderboard Analytics
 *
 * Returns the top 5 campaigns for this organization ranked by total QR scans.
 *
 * Data flow:
 * 1. Fetch all campaigns with postgrid_tracker_id, campaign_name, postcards_sent
 * 2. For each campaign call PostGrid GET /trackers/{id} → read visitCount
 * 3. Sort by visitCount descending, take top LEADERBOARD_SIZE
 * 4. Assign ranking_position 1–N
 * 5. Compute scan_rate = (total_scans / total_postcards_sent) * 100
 *
 * Campaigns without a tracker or with zero scans are excluded from the board.
 * total_postcards_sent comes from campaigns.postcards_sent (maintained by
 * updatePostCardsSentCount after each campaign send).
 */
async function computeCampaignLeaderboard(
  supabase: any,
  organizationId: string,
  filters: AnalyticsFilters,
): Promise<CampaignLeaderboardData> {
  const postgridApiKey =
    Deno.env.get("POSTGRID_POSTCARD_API_KEY") ??
    Deno.env.get("VITE_POSTGRID_POSTCARD_API_KEY");

  let campaignsQuery = supabase
    .from("campaigns")
    .select("id, campaign_name, postgrid_tracker_id, postcards_sent")
    .eq("organization_id", organizationId)
    .not("postgrid_tracker_id", "is", null);
  if (filters.campaign_ids) campaignsQuery = campaignsQuery.in("id", filters.campaign_ids);
  const { data: campaigns, error: campaignsError } = await campaignsQuery;

  if (campaignsError) {
    console.error("Error fetching campaigns for campaign_leaderboard:", campaignsError);
    throw new Error("Failed to fetch campaign data");
  }

  const campaignList: Array<{
    id: string;
    campaign_name: string;
    postgrid_tracker_id: string;
    postcards_sent: number | null;
  }> = campaigns ?? [];

  if (campaignList.length === 0 || !postgridApiKey) {
    return { leaderboard: [] };
  }

  // if (isSimulatedOrg(organizationId)) {
  //   return simulateCampaignLeaderboard(campaignList);
  // }

  // Fetch scan counts — use visits endpoint when time filter is set, tracker summary otherwise
  const entries: Array<Omit<LeaderboardEntry, "ranking_position">> = [];

  await Promise.all(
    campaignList.map(async (campaign) => {
      try {
        let totalScans = 0;

        if (filters.since) {
          // Time-filtered: fetch visits and count those within the window
          const response = await fetch(
            `${POSTGRID_TRACKER_BASE_URL}/${campaign.postgrid_tracker_id}/visits?limit=1000&skip=0`,
            { headers: { "x-api-key": postgridApiKey } },
          );
          if (!response.ok) return;
          const result = await response.json();
          const visits: Array<Record<string, any>> = Array.isArray(result.data)
            ? result.data
            : Array.isArray(result)
            ? result
            : [];
          totalScans = visits.filter((v) => {
            const ts = v.createdAt ?? v.created_at;
            return ts && ts >= filters.since!;
          }).length;
        } else {
          // No time filter: use tracker summary (faster)
          const response = await fetch(
            `${POSTGRID_TRACKER_BASE_URL}/${campaign.postgrid_tracker_id}`,
            { headers: { "x-api-key": postgridApiKey } },
          );
          if (!response.ok) {
            console.warn(
              `[campaign_leaderboard] PostGrid ${response.status} for tracker ${campaign.postgrid_tracker_id}`,
            );
            return;
          }
          const data = await response.json();
          totalScans = data.visitCount ?? 0;
        }

        if (totalScans === 0) return;

        const totalPostcardsSent: number = campaign.postcards_sent ?? 0;
        const scanRate =
          totalPostcardsSent > 0
            ? Math.round((totalScans / totalPostcardsSent) * 10000) / 100
            : 0;

        entries.push({
          campaign_name: campaign.campaign_name,
          total_scans: totalScans,
          total_postcards_sent: totalPostcardsSent,
          scan_rate: scanRate,
        });
      } catch (err) {
        console.error(
          `[campaign_leaderboard] Failed for tracker ${campaign.postgrid_tracker_id}:`,
          err,
        );
      }
    }),
  );

  // Sort by total_scans descending, take top N, assign ranking_position
  const leaderboard: LeaderboardEntry[] = entries
    .sort((a, b) => b.total_scans - a.total_scans)
    .slice(0, LEADERBOARD_SIZE)
    .map((entry, index) => ({ ...entry, ranking_position: index + 1 }));

  return { leaderboard };
}

// ---------------------------------------------------------------------------
// Performance Trend
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Compute Performance Trend Analytics
 *
 * Returns delivery and scan rate metrics broken down across three time windows
 * for the current calendar period:
 *
 *   daily_data   — today only (single object)
 *   weekly_data  — each day of the current Mon–Sun calendar week (7 entries)
 *   monthly_data — current month split into fixed weekly buckets:
 *                  Week 1: 1–7, Week 2: 8–14, Week 3: 15–21,
 *                  Week 4: 22–28, Week 5: 29–end of month
 *
 * delivery_rate per period = completed postcards created in that period / total postcards created in that period
 * scan_rate per period     = scans that occurred in that period / total postcards sent (org-wide, all time)
 * total_volume             = postcards created in that period
 *
 * campaign_ids filter scopes both postcard_sends and PostGrid tracker queries.
 * Time-based filters (last_24hours etc.) are ignored — the structure is fixed to today/this week/this month.
 */
async function computePerformanceTrend(
  supabase: any,
  organizationId: string,
  filters: AnalyticsFilters,
): Promise<PerformanceDayPoint[]> {
  const postgridApiKey =
    Deno.env.get("POSTGRID_POSTCARD_API_KEY") ??
    Deno.env.get("VITE_POSTGRID_POSTCARD_API_KEY");

  const rate4dp = (n: number, d: number): number =>
    d > 0 ? Math.round((n / d) * 10000) / 10000 : 0;

  const now = new Date();
  const toDateStr = (d: Date): string => d.toISOString().slice(0, 10);

  // --- 1. Fetch all postcard_sends ---
  let postcardsQuery = supabase
    .from("postcard_sends")
    .select("created_at, postgrid_status")
    .eq("organization_id", organizationId);
  if (filters.campaign_ids) postcardsQuery = postcardsQuery.in("campaign_id", filters.campaign_ids);
  const { data: postcardsRaw, error: postcardsError } = await postcardsQuery;

  if (postcardsError) {
    console.error("Error fetching postcard_sends for performance_trend:", postcardsError);
    throw new Error("Failed to fetch postcard data");
  }

  const postcards: Array<{ created_at: string; postgrid_status: string }> = postcardsRaw ?? [];
  const totalSent = postcards.length;

  // --- 2. Fetch PostGrid visits, bucket by date ---
  const scansByDate = new Map<string, number>();

  if (postgridApiKey) {
    let campaignsQuery = supabase
      .from("campaigns")
      .select("postgrid_tracker_id")
      .eq("organization_id", organizationId)
      .not("postgrid_tracker_id", "is", null);
    if (filters.campaign_ids) campaignsQuery = campaignsQuery.in("id", filters.campaign_ids);
    const { data: campaigns } = await campaignsQuery;

    if (campaigns && campaigns.length > 0) {
      await Promise.all(
        (campaigns as Array<{ postgrid_tracker_id: string }>).map(async (c) => {
          try {
            const response = await fetch(
              `${POSTGRID_TRACKER_BASE_URL}/${c.postgrid_tracker_id}/visits?limit=1000&skip=0`,
              { headers: { "x-api-key": postgridApiKey } },
            );
            if (!response.ok) return;
            const result = await response.json();
            const visits: Array<Record<string, any>> = Array.isArray(result.data)
              ? result.data
              : Array.isArray(result)
              ? result
              : [];

            for (const v of visits) {
              const ts: string | undefined = v.createdAt ?? v.created_at;
              if (!ts) continue;
              const dateStr = ts.slice(0, 10);
              scansByDate.set(dateStr, (scansByDate.get(dateStr) ?? 0) + 1);
            }
          } catch (err) {
            console.error(`[performance_trend] Failed for tracker ${c.postgrid_tracker_id}:`, err);
          }
        }),
      );
    }
  }

  // Metrics for a single calendar date (YYYY-MM-DD)
  const metricsForDate = (dateStr: string) => {
    const dayCards = postcards.filter((p) => p.created_at.slice(0, 10) === dateStr);
    const vol = dayCards.length;
    const delivered = dayCards.filter((p) => p.postgrid_status === "completed").length;
    const scans = scansByDate.get(dateStr) ?? 0;
    return {
      delivery_rate: rate4dp(delivered, vol),
      scan_rate: rate4dp(scans, totalSent),
      total_volume: vol,
    };
  };

  // Last 6 months of daily data, oldest to newest, today as final entry
  const data = Array.from({ length: 180 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - 179 + i);
    const dateStr = toDateStr(d);
    return { date: dateStr, day: DAY_NAMES[d.getDay()], ...metricsForDate(dateStr) };
  });

  if (filters.timeFilter === "last_24hours") return data.slice(-1);
  if (filters.timeFilter === "last_week") return data.slice(-7);
  if (filters.timeFilter === "last_month") {
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysSinceFirst = Math.floor((now.getTime() - firstOfMonth.getTime()) / 86_400_000);
    return data.slice(179 - daysSinceFirst);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Campaign Performance
// ---------------------------------------------------------------------------

const PERFORMANCE_SIZE = 5;

/**
 * Compute Campaign Performance Analytics
 *
 * Ranks ALL campaigns with a PostGrid tracker by total QR scans and returns:
 *   top_performers    — top 5 ranked 1–5  (most scans)
 *   bottom_performers — bottom 5 ranked 6–10 (least scans)
 *
 * ranking_position is global across all campaigns (1 = most scans, N = least).
 * If there are 5 or fewer campaigns total, all go into top_performers and
 * bottom_performers is empty (no overlap).
 *
 * Unlike campaign_leaderboard, campaigns with 0 scans are included so that
 * the worst performers are always visible.
 */
async function computeCampaignPerformance(
  supabase: any,
  organizationId: string,
  filters: AnalyticsFilters,
): Promise<CampaignPerformanceData> {
  const postgridApiKey =
    Deno.env.get("POSTGRID_POSTCARD_API_KEY") ??
    Deno.env.get("VITE_POSTGRID_POSTCARD_API_KEY");

  let campaignsQuery = supabase
    .from("campaigns")
    .select("id, campaign_name, postgrid_tracker_id, postcards_sent")
    .eq("organization_id", organizationId)
    .not("postgrid_tracker_id", "is", null);
  if (filters.campaign_ids) campaignsQuery = campaignsQuery.in("id", filters.campaign_ids);
  const { data: campaigns, error: campaignsError } = await campaignsQuery;

  if (campaignsError) {
    console.error("Error fetching campaigns for campaign_performance:", campaignsError);
    throw new Error("Failed to fetch campaign data");
  }

  const campaignList: Array<{
    id: string;
    campaign_name: string;
    postgrid_tracker_id: string;
    postcards_sent: number | null;
  }> = campaigns ?? [];

  if (campaignList.length === 0 || !postgridApiKey) {
    return { top_performers: [], bottom_performers: [] };
  }

  const entries: Array<Omit<LeaderboardEntry, "ranking_position">> = [];

  await Promise.all(
    campaignList.map(async (campaign) => {
      try {
        let totalScans = 0;

        if (filters.since) {
          const response = await fetch(
            `${POSTGRID_TRACKER_BASE_URL}/${campaign.postgrid_tracker_id}/visits?limit=1000&skip=0`,
            { headers: { "x-api-key": postgridApiKey } },
          );
          if (!response.ok) return;
          const result = await response.json();
          const visits: Array<Record<string, any>> = Array.isArray(result.data)
            ? result.data
            : Array.isArray(result)
            ? result
            : [];
          totalScans = visits.filter((v) => {
            const ts = v.createdAt ?? v.created_at;
            return ts && ts >= filters.since!;
          }).length;
        } else {
          const response = await fetch(
            `${POSTGRID_TRACKER_BASE_URL}/${campaign.postgrid_tracker_id}`,
            { headers: { "x-api-key": postgridApiKey } },
          );
          if (!response.ok) {
            console.warn(
              `[campaign_performance] PostGrid ${response.status} for tracker ${campaign.postgrid_tracker_id}`,
            );
            return;
          }
          const data = await response.json();
          totalScans = data.visitCount ?? 0;
        }

        const totalPostcardsSent = campaign.postcards_sent ?? 0;
        const scanRate =
          totalPostcardsSent > 0
            ? Math.round((totalScans / totalPostcardsSent) * 10000) / 10000
            : 0;

        entries.push({
          campaign_name: campaign.campaign_name,
          total_scans: totalScans,
          total_postcards_sent: totalPostcardsSent,
          scan_rate: scanRate,
        });
      } catch (err) {
        console.error(
          `[campaign_performance] Failed for tracker ${campaign.postgrid_tracker_id}:`,
          err,
        );
      }
    }),
  );

  // Sort descending, assign global ranking_position 1..N
  entries.sort((a, b) => b.total_scans - a.total_scans);
  const ranked: LeaderboardEntry[] = entries.map((entry, index) => ({
    ...entry,
    ranking_position: index + 1,
  }));

  const top_performers = ranked.slice(0, PERFORMANCE_SIZE);
  // Bottom 5 only from entries beyond the top 5 — no overlap
  const bottom_performers = ranked.length > PERFORMANCE_SIZE
    ? ranked.slice(-PERFORMANCE_SIZE)
    : [];

  return { top_performers, bottom_performers };
}

// ---------------------------------------------------------------------------
// Scan Trend By Type
// ---------------------------------------------------------------------------

type CampaignTargetType = "location_zone" | "referral" | "addresses_list";

const TARGET_TYPE_MAP: Record<string, CampaignTargetType> = {
  "Location Zone": "location_zone",
  "Referral": "referral",
  "Addresses List": "addresses_list",
};

/**
 * Compute Scan Trend By Campaign Target Type
 *
 * Shows what fraction of QR scans in each time period came from each
 * campaign_target_type (Location Zone / Referral / Addresses List).
 *
 * Structure mirrors performance_trend:
 *   daily_data   — today (single object)
 *   weekly_data  — Mon–Sun of current calendar week (7 entries)
 *   monthly_data — current month in 5 weekly buckets (1–7, 8–14, 15–21, 22–28, 29–end)
 *
 * For each period:
 *   location_zone  = scans from Location Zone campaigns  / total scans in period
 *   referral       = scans from Referral campaigns        / total scans in period
 *   addresses_list = scans from Addresses List campaigns  / total scans in period
 *   (the three fractions sum to 1.0 when total > 0, all 0.0 when no scans)
 *
 * Scans are sourced from PostGrid GET /trackers/{id}/visits per campaign.
 * campaign_ids filter scopes which campaigns are included.
 * Time-based filters are ignored — the windows are always today / this week / this month.
 */
async function computeScanTrendByType(
  supabase: any,
  organizationId: string,
  filters: AnalyticsFilters,
): Promise<ScanTrendByTypeDayPoint[]> {
  const postgridApiKey =
    Deno.env.get("POSTGRID_POSTCARD_API_KEY") ??
    Deno.env.get("VITE_POSTGRID_POSTCARD_API_KEY");

  const now = new Date();
  const toDateStr = (d: Date): string => d.toISOString().slice(0, 10);

  // Fetch campaigns with trackers, target type, and postcards_sent
  let campaignsQuery = supabase
    .from("campaigns")
    .select("postgrid_tracker_id, campaign_target_type, postcards_sent")
    .eq("organization_id", organizationId)
    .not("postgrid_tracker_id", "is", null)
    .not("campaign_target_type", "is", null);
  if (filters.campaign_ids) campaignsQuery = campaignsQuery.in("id", filters.campaign_ids);
  const { data: campaigns, error: campaignsError } = await campaignsQuery;

  if (campaignsError) {
    console.error("Error fetching campaigns for scan_trend_by_type:", campaignsError);
    throw new Error("Failed to fetch campaign data");
  }

  const campaignList: Array<{
    postgrid_tracker_id: string;
    campaign_target_type: string;
    postcards_sent: number | null;
  }> = (campaigns ?? []).filter(
    (c: any) => c.campaign_target_type in TARGET_TYPE_MAP,
  );

  // Sum postcards_sent per type — used as the scan rate denominator
  const postcardsSentByType: Record<CampaignTargetType, number> = {
    location_zone: 0,
    referral: 0,
    addresses_list: 0,
  };
  for (const c of campaignList) {
    const typeKey = TARGET_TYPE_MAP[c.campaign_target_type];
    postcardsSentByType[typeKey] += c.postcards_sent ?? 0;
  }

  // scansByDateByType[dateStr][typeKey] = count
  const scansByDateByType = new Map<string, Partial<Record<CampaignTargetType, number>>>();

  const addScan = (dateStr: string, typeKey: CampaignTargetType) => {
    if (!scansByDateByType.has(dateStr)) scansByDateByType.set(dateStr, {});
    const bucket = scansByDateByType.get(dateStr)!;
    bucket[typeKey] = (bucket[typeKey] ?? 0) + 1;
  };

  if (postgridApiKey && campaignList.length > 0) {
    await Promise.all(
      campaignList.map(async (campaign) => {
        const typeKey = TARGET_TYPE_MAP[campaign.campaign_target_type];
        try {
          const response = await fetch(
            `${POSTGRID_TRACKER_BASE_URL}/${campaign.postgrid_tracker_id}/visits?limit=1000&skip=0`,
            { headers: { "x-api-key": postgridApiKey } },
          );
          if (!response.ok) return;
          const result = await response.json();
          const visits: Array<Record<string, any>> = Array.isArray(result.data)
            ? result.data
            : Array.isArray(result)
            ? result
            : [];

          for (const v of visits) {
            const ts: string | undefined = v.createdAt ?? v.created_at;
            if (!ts) continue;
            addScan(ts.slice(0, 10), typeKey);
          }
        } catch (err) {
          console.error(
            `[scan_trend_by_type] Failed for tracker ${campaign.postgrid_tracker_id}:`,
            err,
          );
        }
      }),
    );
  }

  // percentage = scans_for_type / total_postcards_sent_for_that_type (0.0-1.0)
  const scanRate = (count: number, typeKey: CampaignTargetType): number => {
    const denom = postcardsSentByType[typeKey];
    return denom > 0 ? Math.round((count / denom) * 10000) / 10000 : 0;
  };

  const breakdownForDate = (dateStr: string): ScanTypeBreakdown => {
    const b = scansByDateByType.get(dateStr);
    const lz  = b?.location_zone  ?? 0;
    const ref = b?.referral        ?? 0;
    const al  = b?.addresses_list  ?? 0;
    return {
      total_scans: lz + ref + al,
      location_zone:  { count: lz,  percentage: scanRate(lz,  "location_zone")  },
      referral:       { count: ref, percentage: scanRate(ref, "referral")        },
      addresses_list: { count: al,  percentage: scanRate(al,  "addresses_list")  },
    };
  };

  // Last 6 months of daily data, oldest to newest, today as final entry
  const data = Array.from({ length: 180 }, (_, i) => {
    const d = new Date(now);
    d.setDate(now.getDate() - 179 + i);
    const dateStr = toDateStr(d);
    return { date: dateStr, day: DAY_NAMES[d.getDay()], ...breakdownForDate(dateStr) };
  });

  if (filters.timeFilter === "last_24hours") return data.slice(-1);
  if (filters.timeFilter === "last_week") return data.slice(-7);
  if (filters.timeFilter === "last_month") {
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const daysSinceFirst = Math.floor((now.getTime() - firstOfMonth.getTime()) / 86_400_000);
    return data.slice(179 - daysSinceFirst);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Postcard Overview
// ---------------------------------------------------------------------------

/**
 * Compute Postcard Overview Analytics
 *
 * For every campaign in the org, breaks down postcards into four buckets:
 *   delivered_and_scanned     — delivered (completed) AND QR was scanned (fraction of total sent)
 *   delivered_but_not_scanned — delivered (completed) but QR never scanned (fraction of total sent)
 *   in_transit                — still in the delivery pipeline (ready/printing/processed_for_delivery)
 *   returned_cancelled        — returned to sender (imb_status) OR cancelled (postgrid_status)
 *
 * Percentages are 0.0–1.0 (4 decimal places), counts are integers.
 * total_summary aggregates the same fields across all campaigns.
 * campaign_ids filter limits which campaigns are included.
 */
async function computePostcardOverview(
  supabase: any,
  organizationId: string,
  filters: AnalyticsFilters,
): Promise<PostcardOverviewData> {
  const postgridApiKey =
    Deno.env.get("POSTGRID_POSTCARD_API_KEY") ??
    Deno.env.get("VITE_POSTGRID_POSTCARD_API_KEY");

  const emptySummary: PostcardOverviewSummary = {
    delivered_and_scanned: 0,
    delivered_but_not_scanned: 0,
    in_transit: 0,
    returned_cancelled: 0,
  };

  // 1. Fetch campaigns
  let campaignsQuery = supabase
    .from("campaigns")
    .select("id, campaign_name, postgrid_tracker_id, postcards_sent")
    .eq("organization_id", organizationId);
  if (filters.campaign_ids) campaignsQuery = campaignsQuery.in("id", filters.campaign_ids);
  const { data: campaigns, error: campaignsError } = await campaignsQuery;

  if (campaignsError) {
    console.error("Error fetching campaigns for postcard_overview:", campaignsError);
    throw new Error("Failed to fetch campaign data");
  }

  const campaignList: Array<{
    id: string;
    campaign_name: string;
    postgrid_tracker_id: string | null;
    postcards_sent: number | null;
  }> = campaigns ?? [];

  if (campaignList.length === 0) {
    return { total_summary: emptySummary, campaign_summary: [] };
  }

  // 2. Fetch postcard_sends for all campaigns in one query
  const campaignIds = campaignList.map((c) => c.id);
  let sendsQuery = supabase
    .from("postcard_sends")
    .select("postgrid_status, imb_status, campaign_id")
    .eq("organization_id", organizationId)
    .in("campaign_id", campaignIds);
  if (filters.since) sendsQuery = sendsQuery.gte("created_at", filters.since);
  const { data: sends, error: sendsError } = await sendsQuery;

  if (sendsError) {
    console.error("Error fetching postcard_sends for postcard_overview:", sendsError);
    throw new Error("Failed to fetch postcard data");
  }

  type SendRow = { postgrid_status: string; imb_status: string | null; campaign_id: string };
  const sendRows: SendRow[] = sends ?? [];

  // Group sends by campaign_id
  const sendsByCampaign = new Map<string, SendRow[]>();
  for (const row of sendRows) {
    if (!sendsByCampaign.has(row.campaign_id)) sendsByCampaign.set(row.campaign_id, []);
    sendsByCampaign.get(row.campaign_id)!.push(row);
  }

  // 3. Fetch total scan count per campaign from tracker summary
  const scanCountByCampaign = new Map<string, number>();

  if (postgridApiKey) {
    await Promise.all(
      campaignList
        .filter((c) => c.postgrid_tracker_id)
        .map(async (campaign) => {
          try {
            const response = await fetch(
              `${POSTGRID_TRACKER_BASE_URL}/${campaign.postgrid_tracker_id}`,
              { headers: { "x-api-key": postgridApiKey } },
            );
            if (!response.ok) return;
            const result = await response.json();
            scanCountByCampaign.set(campaign.id, result.visitCount ?? 0);
          } catch (err) {
            console.error(`[postcard_overview] Failed for tracker ${campaign.postgrid_tracker_id}:`, err);
          }
        }),
    );
  }

  // 4. Compute per-campaign buckets
  let totalDeliveredAndScanned = 0;
  let totalDeliveredNotScanned = 0;
  let totalInTransit = 0;
  let totalReturnedCancelled = 0;

  const campaign_summary: CampaignOverviewEntry[] = campaignList.map((campaign) => {
    const rows = sendsByCampaign.get(campaign.id) ?? [];
    const totalScans = scanCountByCampaign.get(campaign.id) ?? 0;

    let deliveredCount = 0;
    let inTransit = 0;
    let returnedCancelled = 0;

    for (const row of rows) {
      if (row.postgrid_status === "completed") deliveredCount++;
      if (IN_FLIGHT_STATUSES.includes(row.postgrid_status)) inTransit++;
      if (row.postgrid_status === "cancelled" || row.imb_status === "returned_to_sender") returnedCancelled++;
    }

    const deliveredAndScanned = Math.min(totalScans, deliveredCount);
    const deliveredNotScanned = deliveredCount - deliveredAndScanned;

    totalDeliveredAndScanned += deliveredAndScanned;
    totalDeliveredNotScanned += deliveredNotScanned;
    totalInTransit += inTransit;
    totalReturnedCancelled += returnedCancelled;

    return {
      campaign_id: campaign.id,
      campaign_name: campaign.campaign_name,
      total_postcards_sent: campaign.postcards_sent ?? 0,
      delivered_and_scanned: deliveredAndScanned,
      delivered_but_not_scanned: deliveredNotScanned,
      in_transit: inTransit,
      returned_cancelled: returnedCancelled,
    };
  });

  return {
    total_summary: {
      delivered_and_scanned: totalDeliveredAndScanned,
      delivered_but_not_scanned: totalDeliveredNotScanned,
      in_transit: totalInTransit,
      returned_cancelled: totalReturnedCancelled,
    },
    campaign_summary,
  };
}

// ---------------------------------------------------------------------------
// Active Campaigns
// ---------------------------------------------------------------------------

async function computeActiveCampaigns(
  supabase: any,
  organizationId: string,
  filters: AnalyticsFilters,
): Promise<ActiveCampaignEntry[]> {
  const postgridApiKey =
    Deno.env.get("POSTGRID_POSTCARD_API_KEY") ??
    Deno.env.get("VITE_POSTGRID_POSTCARD_API_KEY");

  let campaignsQuery = supabase
    .from("campaigns")
    .select("id, campaign_name, created_at, postgrid_tracker_id, postcards_sent")
    .eq("organization_id", organizationId)
    .filter("status->>name", "eq", "Active");
  if (filters.campaign_ids) campaignsQuery = campaignsQuery.in("id", filters.campaign_ids);
  const { data: campaignsRaw, error: campaignsError } = await campaignsQuery;
  if (campaignsError) throw new Error("Failed to fetch active campaigns");

  const campaigns: Array<{
    id: string;
    campaign_name: string;
    created_at: string;
    postgrid_tracker_id: string | null;
    postcards_sent: number | null;
  }> = campaignsRaw ?? [];

  if (campaigns.length === 0) return [];

  const campaignIds = campaigns.map((c) => c.id);

  // Fetch all postcard_sends for active campaigns in one query
  const { data: sendsRaw } = await supabase
    .from("postcard_sends")
    .select("campaign_id, postgrid_status, imb_status")
    .in("campaign_id", campaignIds);

  const sends: Array<{ campaign_id: string; postgrid_status: string; imb_status: string | null }> =
    sendsRaw ?? [];

  const sendsByCampaign = new Map<string, typeof sends>();
  for (const s of sends) {
    if (!sendsByCampaign.has(s.campaign_id)) sendsByCampaign.set(s.campaign_id, []);
    sendsByCampaign.get(s.campaign_id)!.push(s);
  }

  // Fetch total scan count per campaign tracker (summary endpoint)
  const scansByCampaignId = new Map<string, number>();
  if (postgridApiKey) {
    await Promise.all(
      campaigns
        .filter((c) => c.postgrid_tracker_id)
        .map(async (c) => {
          try {
            const resp = await fetch(
              `${POSTGRID_TRACKER_BASE_URL}/${c.postgrid_tracker_id}`,
              { headers: { "x-api-key": postgridApiKey } },
            );
            if (!resp.ok) return;
            const result = await resp.json();
            scansByCampaignId.set(c.id, result.visitCount ?? 0);
          } catch { /* skip */ }
        }),
    );
  }

  const now = new Date();

  return campaigns.map((c) => {
    const campaignSends = sendsByCampaign.get(c.id) ?? [];
    const delivered = campaignSends.filter((s) => s.postgrid_status === "completed").length;
    const inFlight = campaignSends.filter((s) =>
      IN_FLIGHT_STATUSES.includes(s.postgrid_status)
    ).length;
    const totalSent = c.postcards_sent ?? 0;
    const deliveryRate = totalSent > 0 ? Math.round((delivered / totalSent) * 10000) / 10000 : 0;
    const daysRunning = Math.floor(
      (now.getTime() - new Date(c.created_at).getTime()) / 86_400_000,
    );

    let status: ActiveCampaignStatus;
    if (campaignSends.length === 0) status = "Pending";
    else if (deliveryRate >= 0.80) status = "On Track";
    else if (deliveryRate >= 0.60) status = "Delayed";
    else status = "At Risk";

    return {
      campaign_id: c.id,
      campaign_name: c.campaign_name,
      days_running: daysRunning,
      in_flight: inFlight,
      scans: scansByCampaignId.get(c.id) ?? 0,
      delivery_rate: deliveryRate,
      status,
    };
  });
}
