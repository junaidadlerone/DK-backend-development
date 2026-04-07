import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { getUserPreferences } from "../_shared/preferences.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { enrichCurrency } from "../_shared/currency.ts";

/**
 * Get Payment History For Campaign Edge Function
 * Returns all payment records linked to a specific campaign.
 *
 * Business Rules:
 * - ADMIN only
 * - campaign_id must belong to the user's organization
 * - Returns records in reverse chronological order
 *
 * Request body:
 * {
 *   "campaign_id": "uuid"
 * }
 */

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
      return errorResponse("NO_ORGANIZATION", "User is not associated with any organization", 403);
    }

    const { data: userProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.userId)
      .single();

    if (!userProfile || userProfile.role !== "ADMIN") {
      return errorResponse("FORBIDDEN", "Only ADMIN users can view payment history", 403);
    }

    let body: { campaign_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON format in request body", 400);
    }

    const { campaign_id } = body;

    if (!campaign_id || typeof campaign_id !== "string") {
      return errorResponse("INVALID_INPUT", "campaign_id is required and must be a string", 400);
    }

    // Verify the campaign belongs to this organization
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaign_id)
      .eq("organization_id", organizationId)
      .single();

    if (!campaign) {
      return errorResponse(
        "NOT_FOUND",
        "Campaign not found or does not belong to your organization",
        404
      );
    }

    const { data: records, error } = await supabase
      .from("payment_history")
      .select("*")
      .eq("campaign_id", campaign_id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching payment_history:", error);
      return errorResponse("INTERNAL_ERROR", "Failed to fetch payment history", 500);
    }

    const preferences = await getUserPreferences(supabase, user.userId);

    const payments = (records || []).map((row) => ({
      id: row.id,
      campaign_id: row.campaign_id,
      amount_paid: row.amount_paid,
      amount_display: enrichCurrency(row.amount_paid, preferences.currency),
      currency: row.currency,
      stripe_charge_id: row.stripe_charge_id,
      stripe_invoice_id: row.stripe_invoice_id,
      coupon_applied: row.coupon_applied,
      created_at: row.created_at,
      created_tz: enrichTimestamp(row.created_at, preferences.timezone),
    }));

    return successResponse({
      status: "success",
      campaign_id,
      payments,
      total: payments.length,
    });

  } catch (error) {
    const err = error as any;
    console.error("Unexpected error in getPaymentHistoryForCampaign:", err);
    return errorResponse("INTERNAL_ERROR", `An unexpected error occurred: ${err.message}`, 500);
  }
});
