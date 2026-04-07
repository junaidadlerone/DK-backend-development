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

    // Also fetch paid invoices — coupon-based charges go through Stripe Invoices
    // and may not appear in charges.list() due to API version differences or
    // timing delays between invoice payment and charge propagation.
    // Expanding data.charge gives us the actual amount charged and card details
    // directly from the charge object, avoiding fields like total/amount_paid
    // that may be undefined in the invoice list response.
    const paidInvoices = await stripe.invoices.list({
      customer: org.stripe_customer_id,
      status: "paid",
      limit,
      expand: ["data.charge"],
    });

    // Fetch user preferences for enrichment
    const preferences = await getUserPreferences(supabase, user.userId);

    // Track charge IDs and invoice IDs already covered by the charges list
    // to avoid showing the same payment twice.
    const capturedChargeIds = new Set(charges.data.map((c) => c.id));
    const capturedInvoiceIds = new Set(
      charges.data
        .map((c) => (typeof c.invoice === "string" ? c.invoice : null))
        .filter(Boolean) as string[]
    );

    // Format direct charges
    const chargeTransactions = charges.data.map((charge) => ({
      id: charge.id,
      amount: charge.amount / 100,
      currency: charge.currency,
      amount_display: enrichCurrency(charge.amount / 100, preferences.currency),
      status: charge.status,
      description: charge.description || "No description",
      created: new Date(charge.created * 1000).toISOString(),
      created_tz: enrichTimestamp(new Date(charge.created * 1000).toISOString(), preferences.timezone),
      receipt_url: charge.receipt_url,
      payment_method: charge.payment_method_details?.card ? {
        brand: charge.payment_method_details.card.brand,
        last4: charge.payment_method_details.card.last4,
      } : null,
      refunded: charge.refunded,
      amount_refunded: charge.amount_refunded,
      invoice_id: (charge.invoice as string) || null,
      discount_applied: (charge.metadata as Record<string, string>)?.coupon_applied || null,
    }));

    // Build a lookup map from charge ID → payment_method details for resolving
    // the card info on invoice-based transactions.
    const chargePaymentMethodMap = new Map<string, { brand: string; last4: string }>();
    for (const charge of charges.data) {
      if (charge.payment_method_details?.card) {
        chargePaymentMethodMap.set(charge.id, {
          brand: charge.payment_method_details.card.brand || "unknown",
          last4: charge.payment_method_details.card.last4 || "****",
        });
      }
    }

    // Format invoice-based transactions (coupon charges), skipping any whose
    // underlying charge is already present in the direct charges list.
    const invoiceTransactions = paidInvoices.data
      .filter((inv) => {
        const chargeId = typeof inv.charge === "string" ? inv.charge : null;
        // Skip if the charge is already in the list, or if the invoice itself is already referenced
        if (chargeId && capturedChargeIds.has(chargeId)) return false;
        if (capturedInvoiceIds.has(inv.id)) return false;
        return true;
      })
      .map((inv) => {
        // inv.charge is now the full expanded Charge object (not just an ID)
        const expandedCharge = inv.charge && typeof inv.charge === "object" ? inv.charge : null;
        const chargeId = expandedCharge?.id || (typeof inv.charge === "string" ? inv.charge : null);
        const meta = (inv.metadata || {}) as Record<string, string>;
        const couponApplied = meta.coupon_applied || null;

        // Derive description from the first invoice line item, falling back to metadata
        const firstLine = inv.lines?.data?.[0];
        const description = firstLine?.description || meta.campaign_name || "Invoice payment";

        // Prefer the Stripe-hosted invoice PDF for receipt (shows coupon discount line)
        const receiptUrl = inv.invoice_pdf || inv.hosted_invoice_url || null;

        // Prefer amount stored in invoice metadata (written by chargePaymentMethod).
        // This is the most reliable source — Stripe's total/amount_paid fields
        // may not be populated on the list response until async settlement completes.
        const metaAmount = meta.final_amount_cents ? parseInt(meta.final_amount_cents) : null;
        const amountCents = metaAmount ?? expandedCharge?.amount ?? inv.total ?? inv.amount_paid ?? 0;

        // Resolve payment method: prefer metadata (written by chargePaymentMethod),
        // then try the expanded charge, then fall back to the charges list map.
        const expandedCard = expandedCharge?.payment_method_details?.card;
        const pm = (meta.card_brand && meta.card_last4)
          ? { brand: meta.card_brand, last4: meta.card_last4 }
          : expandedCard
            ? { brand: expandedCard.brand || "unknown", last4: expandedCard.last4 || "****" }
            : (chargeId ? chargePaymentMethodMap.get(chargeId) || null : null);

        return {
          id: chargeId || inv.id,
          amount: amountCents / 100,
          currency: inv.currency,
          amount_display: enrichCurrency(amountCents / 100, preferences.currency),
          status: "succeeded",
          description,
          created: new Date(inv.created * 1000).toISOString(),
          created_tz: enrichTimestamp(new Date(inv.created * 1000).toISOString(), preferences.timezone),
          receipt_url: receiptUrl,
          payment_method: pm,
          refunded: false,
          amount_refunded: 0,
          invoice_id: inv.id,
          discount_applied: couponApplied,
        };
      });

    // Merge and sort by created date descending
    const allTransactions = [...chargeTransactions, ...invoiceTransactions]
      .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
      .slice(0, limit);

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      transactions: allTransactions,
      has_more: charges.has_more || paidInvoices.has_more,
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
