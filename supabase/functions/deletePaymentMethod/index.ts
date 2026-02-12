import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { createStripeClient } from "../_shared/stripe.ts";
import { createNotification } from "../_shared/notifications.ts";

/**
 * Delete Payment Method Edge Function
 * Detaches a payment method from the organization's Stripe customer
 *
 * Business Rules:
 * - ADMIN only
 * - Detaches payment method from customer (soft delete in Stripe)
 * - Cannot delete the default payment method if other payment methods exist
 * - Payment method must belong to the organization's Stripe customer
 * - Organization-scoped
 *
 * Request body:
 * {
 *   "payment_method_id": "pm_xxxxx",
 *   "isTestMode": true
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

    const stripe = createStripeClient(useTestMode);

    // Get customer to check if this is the default payment method
    const customer = await stripe.customers.retrieve(org.stripe_customer_id);

    const defaultPaymentMethodId = typeof customer !== "deleted" && customer.invoice_settings?.default_payment_method
      ? (typeof customer.invoice_settings.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings.default_payment_method.id)
      : null;

    // Check if trying to delete the default payment method
    const isDefaultMethod = payment_method_id === defaultPaymentMethodId;

    // Get all payment methods to check count
    const paymentMethods = await stripe.paymentMethods.list({
      customer: org.stripe_customer_id,
      type: "card",
    });

    // Prevent deleting default payment method if other methods exist
    if (isDefaultMethod && paymentMethods.data.length > 1) {
      return errorResponse(
        "CANNOT_DELETE_DEFAULT",
        "Cannot delete the default payment method. Please set another payment method as default first.",
        400
      );
    }

    // Get payment method details before detaching
    const paymentMethodToDelete = await stripe.paymentMethods.retrieve(payment_method_id);
    const last4 = paymentMethodToDelete.card?.last4 || "****";

    // Detach payment method from customer
    await stripe.paymentMethods.detach(payment_method_id);

    // Create notification for ADMIN users
    await createNotification({
      supabase,
      organizationId,
      notificationType: "PAYMENT_METHOD_REMOVED",
      title: "Payment Method Removed",
      description: `Payment Method ${last4} removed from your organization`,
      targetRoles: ["ADMIN"],
      metadata: {
        payment_method_id: payment_method_id,
        last4: last4,
        brand: paymentMethodToDelete.card?.brand
      }
    });

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      message: "Payment method deleted successfully",
      processingTimeMs,
    });

  } catch (error) {
    console.error("Unexpected error in deletePaymentMethod:", error);

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
