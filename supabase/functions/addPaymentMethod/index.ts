import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { createStripeClient, getOrCreateStripeCustomer } from "../_shared/stripe.ts";
import { createNotification } from "../_shared/notifications.ts";

/**
 * Add Payment Method Edge Function
 * Attaches a payment method to the organization's Stripe customer
 *
 * Business Rules:
 * - ADMIN only
 * - Requires payment_method_id from Stripe.js frontend
 * - Creates Stripe customer if first time
 * - Sets as default payment method if it's the only one
 * - Organization-scoped
 *
 * Request body:
 * {
 *   "payment_method_id": "pm_xxxxx"
 * }
 */

interface RequestBody {
  payment_method_id: string;
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
        "Only ADMIN users can manage payment methods",
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

    const { payment_method_id, isTestMode } = body;

    // Validate payment_method_id
    if (!payment_method_id || typeof payment_method_id !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "payment_method_id is required and must be a string",
        400
      );
    }

    // Determine if using test mode (default to false if not provided)
    const useTestMode = isTestMode === true;

    // Get or create Stripe customer
    const stripeCustomerId = await getOrCreateStripeCustomer(supabase, organizationId, useTestMode);

    // Attach payment method to customer
    const stripe = createStripeClient(useTestMode);

    const paymentMethod = await stripe.paymentMethods.attach(payment_method_id, {
      customer: stripeCustomerId,
    });

    // Check if this is the first payment method for this customer
    const paymentMethods = await stripe.paymentMethods.list({
      customer: stripeCustomerId,
      type: "card",
    });

    // If this is the only payment method, set it as default
    const shouldSetAsDefault = paymentMethods.data.length === 1;

    if (shouldSetAsDefault) {
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: {
          default_payment_method: paymentMethod.id,
        },
      });
    }

    const processingTimeMs = Date.now() - startTime;

    // Create notification for ADMIN users
    const last4 = paymentMethod.card?.last4 || "****";
    await createNotification({
      supabase,
      organizationId,
      notificationType: "PAYMENT_METHOD_ADDED",
      title: "Payment Method Added",
      description: `Payment Method ${last4} added to your organization`,
      targetRoles: ["ADMIN"],
      metadata: {
        payment_method_id: paymentMethod.id,
        last4: last4,
        brand: paymentMethod.card?.brand,
        is_default: shouldSetAsDefault
      }
    });

    return successResponse({
      status: "success",
      message: shouldSetAsDefault
        ? "Payment method added and set as default"
        : "Payment method added successfully",
      payment_method: {
        id: paymentMethod.id,
        type: paymentMethod.type,
        card: paymentMethod.card ? {
          brand: paymentMethod.card.brand,
          last4: paymentMethod.card.last4,
          exp_month: paymentMethod.card.exp_month,
          exp_year: paymentMethod.card.exp_year,
        } : null,
        is_default: shouldSetAsDefault,
      },
      processingTimeMs,
    }, 201);

  } catch (error) {
    console.error("Unexpected error in addPaymentMethod:", error);

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

    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
