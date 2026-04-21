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
}

function parseFilters(body: AnalyticsV2Request): AnalyticsFilters {
  const filters: AnalyticsFilters = { period: "all_time" };
  if (Array.isArray(body.campaign_ids) && body.campaign_ids.length > 0) {
    filters.campaign_ids = body.campaign_ids;
  }
  const now = Date.now();
  if (body.last_24hours === true) {
    filters.since = new Date(now - 86_400_000).toISOString();
    filters.period = "last_24hours";
  } else if (body.last_week === true) {
    filters.since = new Date(now - 7 * 86_400_000).toISOString();
    filters.period = "last_week";
  } else if (body.last_month === true) {
    filters.since = new Date(now - 30 * 86_400_000).toISOString();
    filters.period = "last_month";
  }
  return filters;
}

interface DashboardCardsData {
  in_flight_postcards: number;
  delivered: number;
  delivery_rate: number;
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
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
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

      default:
        return errorResponse(
          "INVALID_TYPE",
          `Analytics type "${type}" is not supported. Supported types: dashboard_cards, delivery_funnel, waste_meter, scan_trend, recent_scans, campaign_leaderboard`,
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
  let postcardsQuery = supabase
    .from("postcard_sends")
    .select("postgrid_status")
    .eq("organization_id", organizationId);
  let paymentsQuery = supabase
    .from("payment_history")
    .select("amount_paid")
    .eq("organization_id", organizationId);

  if (filters.campaign_ids) {
    postcardsQuery = postcardsQuery.in("campaign_id", filters.campaign_ids);
    paymentsQuery = paymentsQuery.in("campaign_id", filters.campaign_ids);
  }
  if (filters.since) {
    postcardsQuery = postcardsQuery.gte("created_at", filters.since);
    paymentsQuery = paymentsQuery.gte("created_at", filters.since);
  }

  const [postcardsResult, paymentsResult] = await Promise.all([
    postcardsQuery,
    paymentsQuery,
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

  return {
    in_flight_postcards: inFlight,
    delivered,
    delivery_rate: deliveryRate,
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
