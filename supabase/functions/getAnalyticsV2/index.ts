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

interface DeliveryFunnelData {
  total_postcards_sent: number;
  // From postgrid_status (standard field)
  delivered: number;
  processed: number;
  printing: number;
  ready: number;
  cancelled: number;
  // From imb_status (Intelligent-Mail Tracking, US only)
  in_transit: number;
  returned: number;
}

interface WasteMeterData {
  status: WasteMeterStatus;
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

    switch (analyticsType) {
      case "dashboard_cards": {
        const preferences = await getUserPreferences(supabase, user.userId);
        const data = await computeDashboardCards(supabase, organizationId, preferences);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      case "delivery_funnel": {
        const data = await computeDeliveryFunnel(supabase, organizationId);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      case "waste_meter": {
        const preferences = await getUserPreferences(supabase, user.userId);
        const data = await computeWasteMeter(supabase, organizationId, preferences);
        return successResponse({
          status: "success",
          message: "Analytics computed successfully",
          data,
        }, 200);
      }

      default:
        return errorResponse(
          "INVALID_TYPE",
          `Analytics type "${type}" is not supported. Supported types: dashboard_cards, delivery_funnel, waste_meter`,
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
): Promise<DashboardCardsData> {
  const [postcardsResult, paymentsResult] = await Promise.all([
    supabase
      .from("postcard_sends")
      .select("postgrid_status")
      .eq("organization_id", organizationId),
    supabase
      .from("payment_history")
      .select("amount_paid")
      .eq("organization_id", organizationId),
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
): Promise<DeliveryFunnelData> {
  const { data: rows, error } = await supabase
    .from("postcard_sends")
    .select("postgrid_status, imb_status")
    .eq("organization_id", organizationId);

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

  const pct = (count: number): number =>
    total > 0 ? Math.round((count / total) * 10000) / 100 : 0;

  return {
    total_postcards_sent: total,
    // From postgrid_status
    delivered: pct(statusCounts.completed),
    processed: pct(statusCounts.processed_for_delivery),
    printing: pct(statusCounts.printing),
    ready: pct(statusCounts.ready),
    cancelled: pct(statusCounts.cancelled),
    // From imb_status — both entered_mail_stream and out_for_delivery mean
    // the postcard is inside the USPS network (in transit toward the recipient)
    in_transit: pct(imbCounts.entered_mail_stream + imbCounts.out_for_delivery),
    returned: pct(imbCounts.returned_to_sender),
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
): Promise<WasteMeterData> {
  const { data: rows, error } = await supabase
    .from("postcard_sends")
    .select("postgrid_status, imb_status, created_at")
    .eq("organization_id", organizationId);

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
