import {
  corsResponse,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { createStripeClient } from "../_shared/stripe.ts";
import { enrichTimestamp } from "../_shared/timezone.ts";
import { getPreferences } from "../_shared/preferences.ts";

/**
 * Get Payment Methods Edge Function
 * Retrieves all payment methods for the organization
 *
 * Business Rules:
 * - ADMIN only
 * - Returns all payment methods from Stripe
 * - Shows which one is the default
 * - Organization-scoped
 */

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST requests to accept body with isTestMode
  if (req.method !== "POST") {
    return errorResponse(
      "METHOD_NOT_ALLOWED",
      "Only POST method is allowed",
      405,
    );
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

    // Check if user is ADMIN
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.userId)
      .single();

    if (!userProfile || userProfile.role !== "ADMIN") {
      return errorResponse(
        "FORBIDDEN",
        "Only ADMIN users can view payment methods",
        403,
      );
    }

    // Parse request body to get isTestMode
    let body: { isTestMode?: boolean } = {};
    try {
      body = await req.json();
    } catch (parseError) {
      // If no body or invalid JSON, default to production mode
      body = {};
    }

    const useTestMode = body.isTestMode === true;

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
        payment_methods: [],
        processingTimeMs: Date.now() - startTime,
      });
    }

    // Fetch payment methods from Stripe
    const stripe = createStripeClient(useTestMode);

    const paymentMethods = await stripe.paymentMethods.list({
      customer: org.stripe_customer_id,
      type: "card",
    });

    // Get customer to find default payment method
    const customer = await stripe.customers.retrieve(org.stripe_customer_id);

    const defaultPaymentMethodId =
      typeof customer !== "deleted" &&
        customer.invoice_settings?.default_payment_method
        ? (typeof customer.invoice_settings.default_payment_method === "string"
          ? customer.invoice_settings.default_payment_method
          : customer.invoice_settings.default_payment_method.id)
        : null;

    // Fetch user preferences
    const preferences = await getPreferences(supabase, user.userId);

    // Format payment methods for response
    const formattedPaymentMethods = paymentMethods.data.map((pm) => ({
      id: pm.id,
      type: pm.type,
      card: pm.card
        ? {
          brand: pm.card.brand,
          last4: pm.card.last4,
          exp_month: pm.card.exp_month,
          exp_year: pm.card.exp_year,
        }
        : null,
      is_default: pm.id === defaultPaymentMethodId,
      created: new Date(pm.created * 1000).toISOString(),
      created_tz: enrichTimestamp(
        new Date(pm.created * 1000).toISOString(),
        preferences.timezone,
      ),
    }));

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      payment_methods: formattedPaymentMethods,
      processingTimeMs,
    });
  } catch (error) {
    console.error("Unexpected error in getPaymentMethods:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500,
    );
  }
});
