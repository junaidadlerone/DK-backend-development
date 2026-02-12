import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { createStripeClient } from "../_shared/stripe.ts";
import { getUserPreferences } from "../_shared/preferences.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { enrichCurrency } from "../_shared/currency.ts";

/**
 * Get Billing History Edge Function
 * Retrieves all charges/transactions for the organization
 *
 * Business Rules:
 * - ADMIN only
 * - Returns all charges from Stripe
 * - Supports pagination via query parameters
 * - Shows amount, status, date, description, receipt URL
 * - Organization-scoped
 *
 * Query parameters:
 * - limit: Number of transactions to return (default: 50, max: 100)
 * - starting_after: Charge ID to start after (for pagination)
 */

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST requests to accept body with isTestMode
  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
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

    // Check if user is ADMIN
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.userId)
      .single();

    if (!userProfile || userProfile.role !== "ADMIN") {
      return errorResponse(
        "FORBIDDEN",
        "Only ADMIN users can view billing history",
        403
      );
    }

    // Parse request body to get isTestMode, limit, and starting_after
    let body: { isTestMode?: boolean; limit?: number; starting_after?: string } = {};
    try {
      body = await req.json();
    } catch (parseError) {
      // If no body or invalid JSON, default to production mode
      body = {};
    }

    const useTestMode = body.isTestMode === true;
    const limit = body.limit ? Math.min(body.limit, 100) : 50;
    const startingAfter = body.starting_after;

    // Get organization's Stripe customer ID
    const { data: org } = await supabase
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", organizationId)
      .single();

    // If no Stripe customer yet, return empty list
    if (!org?.stripe_customer_id) {
      return successResponse({
        status: "success",
        transactions: [],
        has_more: false,
        processingTimeMs: Date.now() - startTime,
      });
    }

    // Fetch charges from Stripe
    const stripe = createStripeClient(useTestMode);

    const params: any = {
      customer: org.stripe_customer_id,
      limit,
    };

    if (startingAfter) {
      params.starting_after = startingAfter;
    }

    const charges = await stripe.charges.list(params);

    // Fetch user preferences for enrichment
    const preferences = await getUserPreferences(supabase, user.userId);

    // Format charges for response
    const formattedTransactions = charges.data.map((charge) => ({
      id: charge.id,
      amount: charge.amount / 100,
      currency: charge.currency,
      
      // Enriched financial data
      amount_display: enrichCurrency(charge.amount / 100, preferences.currency),
      
      status: charge.status,
      description: charge.description || "No description",
      created: new Date(charge.created * 1000).toISOString(),
      
      // Enriched timezone data
      created_tz: enrichTimestamp(new Date(charge.created * 1000).toISOString(), preferences.timezone),
      
      receipt_url: charge.receipt_url,
      payment_method: charge.payment_method_details?.card ? {
        brand: charge.payment_method_details.card.brand,
        last4: charge.payment_method_details.card.last4,
      } : null,
      refunded: charge.refunded,
      amount_refunded: charge.amount_refunded,
    }));

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      transactions: formattedTransactions,
      has_more: charges.has_more,
      processingTimeMs,
    });

  } catch (error) {
    console.error("Unexpected error in getBillingHistory:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
