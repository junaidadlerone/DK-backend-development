import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { createStripeClient } from "../_shared/stripe.ts";

/**
 * Update Payment Method Edge Function
 * Updates payment method details (expiration date) in Stripe
 *
 * Business Rules:
 * - ADMIN only
 * - Can update card expiration date
 * - Payment method must belong to the organization's Stripe customer
 * - Organization-scoped
 *
 * Request body:
 * {
 *   "payment_method_id": "pm_xxxxx",
 *   "exp_month": 12,
 *   "exp_year": 2025,
 *   "isTestMode": true
 * }
 */

interface RequestBody {
  payment_method_id: string;
  exp_month: number;
  exp_year: number;
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

    const { payment_method_id, exp_month, exp_year, isTestMode } = body;

    // Validate payment_method_id
    if (!payment_method_id || typeof payment_method_id !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "payment_method_id is required and must be a string",
        400
      );
    }

    // Validate exp_month
    if (!exp_month || typeof exp_month !== "number" || exp_month < 1 || exp_month > 12) {
      return errorResponse(
        "INVALID_INPUT",
        "exp_month is required and must be a number between 1 and 12",
        400
      );
    }

    // Validate exp_year
    if (!exp_year || typeof exp_year !== "number" || exp_year < new Date().getFullYear()) {
      return errorResponse(
        "INVALID_INPUT",
        "exp_year is required and must be a valid future year",
        400
      );
    }

    // Determine if using test mode (default to false if not provided)
    const useTestMode = isTestMode === true;

    // Get organization's Stripe customer ID
    const { data: org } = await supabase
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", organizationId)
      .single();

    if (!org?.stripe_customer_id) {
      return errorResponse(
        "NO_CUSTOMER",
        "Organization does not have a Stripe customer. Please add a payment method first.",
        404
      );
    }

    // Update payment method in Stripe
    const stripe = createStripeClient(useTestMode);

    const paymentMethod = await stripe.paymentMethods.update(payment_method_id, {
      card: {
        exp_month,
        exp_year,
      },
    });

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      message: "Payment method updated successfully",
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
      processingTimeMs,
    });

  } catch (error) {
    console.error("Unexpected error in updatePaymentMethod:", error);

    // Handle Stripe-specific errors
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
