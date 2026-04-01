import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { createStripeClient } from "../_shared/stripe.ts";

/**
 * Validate Coupon Code Edge Function
 * Validates a Stripe Promotion Code and returns discount details.
 *
 * Business Rules:
 * - ADMIN only
 * - Looks up the promotion code by user-facing string (e.g. "10OFF")
 * - Returns discount type, human-readable label, and discounted amount
 * - Does NOT charge anything
 *
 * Request body:
 * {
 *   "coupon_code": "10OFF",
 *   "amount": 100,        // original amount in USD (e.g. 100 = $100.00)
 *   "isTestMode": true    // optional
 * }
 *
 * Response:
 * {
 *   "status": "success",
 *   "message": "Coupon code is valid",
 *   "discount": "10% OFF",
 *   "initial_amount": 100,
 *   "discounted_amount": 90
 * }
 */

interface RequestBody {
  coupon_code: string;
  amount: number;
  isTestMode?: boolean;
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

    // Check if user is ADMIN
    const { data: userProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.userId)
      .single();

    if (!userProfile || userProfile.role !== "ADMIN") {
      return errorResponse("FORBIDDEN", "Only ADMIN users can validate coupon codes", 403);
    }

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return errorResponse("INVALID_INPUT", "Invalid JSON format in request body", 400);
    }

    const { coupon_code, amount, isTestMode } = body;

    if (!coupon_code || typeof coupon_code !== "string") {
      return errorResponse("INVALID_INPUT", "coupon_code is required and must be a string", 400);
    }

    if (!amount || typeof amount !== "number" || amount <= 0) {
      return errorResponse("INVALID_INPUT", "amount is required and must be a positive number (in USD)", 400);
    }

    const stripe = createStripeClient(isTestMode === true);

    // Look up the promotion code by user-facing string
    const promoCodes = await stripe.promotionCodes.list({
      code: coupon_code,
      active: true,
      limit: 1,
    });

    if (!promoCodes.data.length) {
      return errorResponse(
        "INVALID_COUPON",
        "The coupon code is invalid, inactive, or has expired",
        400
      );
    }

    const promoCode = promoCodes.data[0];
    const coupon = promoCode.coupon;

    if (!coupon.valid) {
      return errorResponse(
        "COUPON_EXPIRED",
        "The coupon code has expired or reached its maximum redemption limit",
        400
      );
    }

    // Calculate discount
    const amountInCents = Math.round(amount * 100);
    let discountAmountCents = 0;
    let discountLabel = "";

    if (coupon.percent_off) {
      discountAmountCents = Math.round(amountInCents * (coupon.percent_off / 100));
      discountLabel = `${coupon.percent_off}% OFF`;
    } else if (coupon.amount_off) {
      discountAmountCents = Math.min(coupon.amount_off, amountInCents);
      discountLabel = `$${(coupon.amount_off / 100).toFixed(2)} discount`;
    }

    const finalAmountCents = amountInCents - discountAmountCents;

    return successResponse({
      status: "success",
      message: "Coupon code is valid",
      discount: discountLabel,
      initial_amount: amount,
      discounted_amount: parseFloat((finalAmountCents / 100).toFixed(2)),
    });

  } catch (error) {
    const err = error as any;
    console.error("Unexpected error in validateCouponCode:", err);

    if (err.type === "StripeInvalidRequestError") {
      return errorResponse("INVALID_REQUEST", err.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", `An unexpected error occurred: ${err.message}`, 500);
  }
});
