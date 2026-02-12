import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { createStripeClient } from "../_shared/stripe.ts";
import { createNotification } from "../_shared/notifications.ts";
import { getUserPreferences } from "../_shared/preferences.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { enrichCurrency } from "../_shared/currency.ts";

/**
 * Charge Payment Method Edge Function
 * Creates a charge using a specific payment method
 *
 * Business Rules:
 * - ADMIN only
 * - Charges the specified payment method
 * - Creates a Payment Intent in Stripe
 * - Confirms the payment immediately
 * - Organization-scoped
 * - Creates notification for ADMIN users
 *
 * Request body:
 * {
 *   "payment_method_id": "pm_xxxxx",
 *   "amount": 5000,
 *   "currency": "usd",
 *   "description": "Campaign postcard printing",
 *   "campaign_name": "Summer Sale 2024",
 *   "isTestMode": true
 * }
 */

interface RequestBody {
  payment_method_id: string;
  amount: number;
  currency?: string;
  description?: string;
  campaign_name?: string;
  isTestMode?: boolean;
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
        "Only ADMIN users can charge payment methods",
        403
      );
    }

    // Parse request body
    let body: RequestBody;
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

    const { payment_method_id, amount, currency = "usd", description, campaign_name, isTestMode } = body;

    // Validate payment_method_id
    if (!payment_method_id || typeof payment_method_id !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "payment_method_id is required and must be a string",
        400
      );
    }

    // Validate amount
    if (!amount || typeof amount !== "number" || amount <= 0) {
      return errorResponse(
        "INVALID_INPUT",
        "amount is required and must be a positive number (in USD)",
        400
      );
    }

    // Convert USD to cents for Stripe
    const amountInCents = Math.round(amount * 100);

    // Validate currency (optional)
    if (currency && typeof currency !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "currency must be a string (e.g., 'usd', 'eur')",
        400
      );
    }

    // Determine if using test mode (default to false if not provided)
    const useTestMode = isTestMode === true;

    // Get organization's Stripe customer ID
    const { data: org } = await supabase
      .from("organizations")
      .select("stripe_customer_id, business_name")
      .eq("id", organizationId)
      .single();

    if (!org?.stripe_customer_id) {
      return errorResponse(
        "NO_CUSTOMER",
        "Organization does not have a Stripe customer. Please add a payment method first.",
        404
      );
    }

    // Create Stripe client
    const stripe = createStripeClient(useTestMode);

    // Verify the payment method belongs to this customer
    const paymentMethod = await stripe.paymentMethods.retrieve(payment_method_id);

    if (paymentMethod.customer !== org.stripe_customer_id) {
      return errorResponse(
        "INVALID_PAYMENT_METHOD",
        "Payment method does not belong to this organization",
        400
      );
    }

    // Create and confirm Payment Intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: currency.toLowerCase(),
      customer: org.stripe_customer_id,
      payment_method: payment_method_id,
      description: description || `Charge for ${org.business_name || "organization"}`,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
      metadata: {
        organization_id: organizationId,
      },
    });

    const processingTimeMs = Date.now() - startTime;

    // Format response based on payment intent status
    if (paymentIntent.status === "succeeded") {
      // Create notification for ADMIN users
      const last4 = paymentMethod.card?.last4 || "****";
      const amountInDollars = (paymentIntent.amount / 100).toFixed(2);
      const campaignText = campaign_name ? ` for campaign launch "${campaign_name}"` : "";

      await createNotification({
        supabase,
        organizationId,
        notificationType: "PAYMENT_CHARGED",
        title: "Payment Charged",
        description: `A charge of $${amountInDollars} made against ${last4} card${campaignText}`,
        targetRoles: ["ADMIN"],
        metadata: {
          payment_intent_id: paymentIntent.id,
          payment_method_id: paymentMethod.id,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          last4: last4,
          campaign_name: campaign_name || null
        }
      });
      
      // Fetch user preferences for enrichment
      const preferences = await getUserPreferences(supabase, user.userId);

      return successResponse({
        status: "success",
        message: "Payment succeeded",
        payment: {
          id: paymentIntent.id,
          amount: paymentIntent.amount,
          currency: paymentIntent.currency,
          
          // Enriched financial data - paymentIntent.amount is in cents
          amount_display: enrichCurrency(paymentIntent.amount / 100, preferences.currency),
          
          status: paymentIntent.status,
          description: paymentIntent.description,
          created: new Date(paymentIntent.created * 1000).toISOString(),
          
          // Enriched timezone data
          created_tz: enrichTimestamp(new Date(paymentIntent.created * 1000).toISOString(), preferences.timezone),
          
          receipt_url: paymentIntent.charges?.data?.[0]?.receipt_url || null,
          payment_method: {
            id: paymentMethod.id,
            type: paymentMethod.type,
            card: paymentMethod.card ? {
              brand: paymentMethod.card.brand,
              last4: paymentMethod.card.last4,
              exp_month: paymentMethod.card.exp_month,
              exp_year: paymentMethod.card.exp_year,
            } : null,
          },
        },
        processingTimeMs,
      }, 201);
    } else if (paymentIntent.status === "requires_action") {
      return errorResponse(
        "REQUIRES_ACTION",
        "Payment requires additional authentication. Please use Stripe.js on the frontend for 3D Secure.",
        400
      );
    } else if (paymentIntent.status === "requires_payment_method") {
      return errorResponse(
        "PAYMENT_FAILED",
        paymentIntent.last_payment_error?.message || "Payment failed. Please try a different payment method.",
        400
      );
    } else {
      return errorResponse(
        "PAYMENT_ERROR",
        `Payment status: ${paymentIntent.status}`,
        400
      );
    }

  } catch (error) {
    console.error("Unexpected error in chargePaymentMethod:", error);

    // Handle Stripe-specific errors
    if (error.type === "StripeCardError") {
      return errorResponse(
        "CARD_ERROR",
        error.message,
        400
      );
    }

    if (error.type === "StripeInvalidRequestError") {
      return errorResponse(
        "INVALID_REQUEST",
        error.message,
        400
      );
    }

    if (error.code === "amount_too_small") {
      return errorResponse(
        "AMOUNT_TOO_SMALL",
        "The amount is too small. Minimum charge amount is 50 cents.",
        400
      );
    }

    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
