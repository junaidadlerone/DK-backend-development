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
 * - If coupon_code is provided (Stripe Promotion Code string), applies it via
 *   an Invoice so the discount appears as a real line item on the receipt PDF.
 * - If no coupon_code, creates a Payment Intent directly (original behavior).
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
 *   "isTestMode": true,
 *   "coupon_code": "SUMMER20"   // optional — Stripe Promotion Code (user-facing string)
 * }
 */

interface RequestBody {
  payment_method_id: string;
  amount: number;
  currency?: string;
  description?: string;
  campaign_name?: string;
  campaign_id?: string;
  isTestMode?: boolean;
  coupon_code?: string;
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

    const {
      payment_method_id,
      amount,
      currency = "usd",
      description,
      campaign_name,
      campaign_id,
      isTestMode,
      coupon_code,
    } = body;

    const desc = (description || '').toLowerCase();
    const payment_type = desc.includes('address') || desc.includes('validation')
      ? 'address_verification'
      : 'postcard_sending';

    // Address verification is no longer billable. Skip Stripe entirely and
    // record nothing in payment_history so the user is never charged for it.
    if (payment_type === 'address_verification') {
      return successResponse({
        status: "success",
        message: "Address verification is free — no charge applied",
        payment: {
          id: null,
          amount: 0,
          currency: currency.toLowerCase(),
          status: "succeeded",
          description: description || "Address verification",
          payment_type,
        },
      }, 200);
    }

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

    // ─────────────────────────────────────────────────────────────────────────
    // COUPON CODE PATH — Invoice-based approach (Approach B)
    //
    // Stripe Coupons/Promotion Codes cannot be applied to a PaymentIntent
    // directly. Using an Invoice ensures:
    //   1. The discount appears as a proper line item on the Stripe PDF receipt.
    //   2. Stripe enforces redemption limits / expiry automatically.
    //   3. getBillingHistory can surface the invoice_id and coupon_applied.
    // ─────────────────────────────────────────────────────────────────────────
    if (coupon_code) {
      // 1. Look up the Stripe Promotion Code by the user-facing string
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

      // Check that the underlying coupon is still valid
      if (!coupon.valid) {
        return errorResponse(
          "COUPON_EXPIRED",
          "The coupon code has expired or reached its maximum redemption limit",
          400
        );
      }

      // 2. Compute expected discount so we can return it in the response
      let discountAmountCents = 0;
      if (coupon.percent_off) {
        discountAmountCents = Math.round(amountInCents * (coupon.percent_off / 100));
      } else if (coupon.amount_off) {
        discountAmountCents = Math.min(coupon.amount_off, amountInCents);
      }
      const finalAmountCents = amountInCents - discountAmountCents;

      // 3. Create the Invoice first (no discounts field — coupons with
      //    minimum_amount restrictions cannot be applied via the discounts param
      //    on invoices that use invoice items; Stripe rejects it).
      //    Instead we manually apply the discount as a negative invoice item.
      let invoice = await stripe.invoices.create({
        customer: org.stripe_customer_id,
        default_payment_method: payment_method_id,
        auto_advance: false,
        metadata: {
          organization_id: organizationId,
          coupon_applied: coupon_code,
          campaign_name: campaign_name || "",
          // Store amounts and card info so getBillingHistory can display them
          // accurately without relying on Stripe's async invoice fields or
          // expand calls that may not resolve in the Deno SDK.
          final_amount_cents: finalAmountCents.toString(),
          original_amount_cents: amountInCents.toString(),
          discount_amount_cents: discountAmountCents.toString(),
          card_brand: paymentMethod.card?.brand || "",
          card_last4: paymentMethod.card?.last4 || "",
        },
      });

      // 4. Attach the full-price line item
      await stripe.invoiceItems.create({
        customer: org.stripe_customer_id,
        invoice: invoice.id,
        amount: amountInCents,
        currency: currency.toLowerCase(),
        description: description || `Charge for ${org.business_name || "organization"}`,
      });

      // 5. Attach a negative line item for the discount so it appears on the PDF
      if (discountAmountCents > 0) {
        await stripe.invoiceItems.create({
          customer: org.stripe_customer_id,
          invoice: invoice.id,
          amount: -discountAmountCents,
          currency: currency.toLowerCase(),
          description: `Discount: ${coupon_code}`,
        });
      }

      // 6. Finalize the invoice — locks in line items, discount, and totals
      invoice = await stripe.invoices.finalizeInvoice(invoice.id);

      // 7. Propagate metadata to the underlying PaymentIntent so that
      //    getBillingHistory can read coupon_applied from the charge's metadata
      if (invoice.payment_intent && typeof invoice.payment_intent === "string") {
        await stripe.paymentIntents.update(invoice.payment_intent, {
          metadata: {
            organization_id: organizationId,
            coupon_applied: coupon_code,
            campaign_name: campaign_name || "",
          },
        });
      }

      // 8. Pay the invoice using the provided payment method.
      //    Stripe may auto-pay the invoice during finalization when the customer
      //    has collection_method: 'charge_automatically' and a default PM set.
      //    In that case invoice.status is already 'paid' — skip the explicit pay call.
      let paidInvoice;
      if (invoice.status === "paid") {
        paidInvoice = invoice;
      } else {
        try {
          paidInvoice = await stripe.invoices.pay(invoice.id);
        } catch (_payError) {
          const payError = _payError as any;
          // Void the invoice to clean up the pending invoice item on payment failure
          try {
            await stripe.invoices.voidInvoice(invoice.id);
          } catch (voidError) {
            console.error("Failed to void invoice after payment error:", voidError);
          }

          if (payError.type === "StripeCardError") {
            return errorResponse("CARD_ERROR", payError.message, 400);
          }
          return errorResponse(
            "PAYMENT_FAILED",
            payError.message || "Invoice payment failed. Please try a different payment method.",
            400
          );
        }
      }

      const processingTimeMs = Date.now() - startTime;

      if (paidInvoice.status === "paid") {
        // 9. Retrieve the underlying Stripe Charge for its receipt_url
        const chargeId = typeof paidInvoice.charge === "string"
          ? paidInvoice.charge
          : (paidInvoice.charge as any)?.id;

        const charge = chargeId ? await stripe.charges.retrieve(chargeId) : null;

        // 10. Save to payment_history if campaign_id provided
        if (campaign_id) {
          await supabase.from("payment_history").insert({
            campaign_id,
            organization_id: organizationId,
            amount_paid: finalAmountCents / 100,
            currency: currency.toLowerCase(),
            stripe_charge_id: chargeId || null,
            stripe_invoice_id: paidInvoice.id,
            coupon_applied: coupon_code || null,
            payment_type: payment_type || null,
            description: description || null,
          });
        }

        // 11. Create notification for ADMIN users
        const last4 = paymentMethod.card?.last4 || "****";
        const amountInDollars = (finalAmountCents / 100).toFixed(2);
        const campaignText = campaign_name ? ` for campaign launch "${campaign_name}"` : "";
        const discountText = discountAmountCents > 0
          ? ` (saved $${(discountAmountCents / 100).toFixed(2)} with code ${coupon_code})`
          : "";

        await createNotification({
          supabase,
          organizationId,
          notificationType: "PAYMENT_CHARGED",
          title: "Payment Charged",
          description: `A charge of $${amountInDollars} made against ${last4} card${campaignText}${discountText}`,
          targetRoles: ["ADMIN"],
          metadata: {
            invoice_id: paidInvoice.id,
            payment_method_id: paymentMethod.id,
            amount: finalAmountCents,
            original_amount: amountInCents,
            discount_amount: discountAmountCents,
            coupon_applied: coupon_code,
            currency: currency.toLowerCase(),
            last4,
            campaign_name: campaign_name || null,
          },
        });

        // 10. Fetch user preferences for enrichment
        const preferences = await getUserPreferences(supabase, user.userId);

        return successResponse({
          status: "success",
          message: "Payment succeeded",
          payment: {
            id: charge?.id || paidInvoice.id,
            amount: finalAmountCents,
            currency: currency.toLowerCase(),

            // Enriched financial data — reflects the discounted amount charged
            amount_display: enrichCurrency(finalAmountCents / 100, preferences.currency),

            status: "succeeded",
            description: description || `Charge for ${org.business_name || "organization"}`,
            created: new Date(paidInvoice.created * 1000).toISOString(),

            // Enriched timezone data
            created_tz: enrichTimestamp(
              new Date(paidInvoice.created * 1000).toISOString(),
              preferences.timezone
            ),

            // The receipt_url opens a Stripe-hosted PDF that shows the
            // original amount, coupon name, discount line, and final total
            receipt_url: charge?.receipt_url || null,

            // Discount breakdown
            original_amount: amountInCents,
            discount_amount: discountAmountCents,
            coupon_applied: coupon_code,
            discount_percent_off: coupon.percent_off ?? null,
            discount_amount_off: coupon.amount_off ?? null,

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
      } else {
        // Invoice didn't end up paid — void it and surface the error
        try {
          await stripe.invoices.voidInvoice(invoice.id);
        } catch (voidError) {
          console.error("Failed to void invoice:", voidError);
        }

        return errorResponse(
          "PAYMENT_ERROR",
          `Invoice payment status: ${paidInvoice.status}`,
          400
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NO COUPON PATH — Invoice approach (same as coupon path, no discount)
    // Using invoices for all charges ensures consistent receipt PDF format.
    // ─────────────────────────────────────────────────────────────────────────

    // 1. Create invoice first, then attach the line item to it
    let plainInvoice = await stripe.invoices.create({
      customer: org.stripe_customer_id,
      default_payment_method: payment_method_id,
      auto_advance: false,
      metadata: {
        organization_id: organizationId,
        campaign_name: campaign_name || "",
        final_amount_cents: amountInCents.toString(),
        card_brand: paymentMethod.card?.brand || "",
        card_last4: paymentMethod.card?.last4 || "",
      },
    });

    await stripe.invoiceItems.create({
      customer: org.stripe_customer_id,
      invoice: plainInvoice.id,
      amount: amountInCents,
      currency: currency.toLowerCase(),
      description: description || `Charge for ${org.business_name || "organization"}`,
    });

    // 2. Finalize
    plainInvoice = await stripe.invoices.finalizeInvoice(plainInvoice.id);

    // 3. Pay (or it may already be paid if auto-advance kicked in)
    let paidPlainInvoice;
    if (plainInvoice.status === "paid") {
      paidPlainInvoice = plainInvoice;
    } else {
      try {
        paidPlainInvoice = await stripe.invoices.pay(plainInvoice.id);
      } catch (_payError) {
        const payError = _payError as any;
        try { await stripe.invoices.voidInvoice(plainInvoice.id); } catch (_) { /* ignore */ }
        if (payError.type === "StripeCardError") {
          return errorResponse("CARD_ERROR", payError.message, 400);
        }
        return errorResponse(
          "PAYMENT_FAILED",
          payError.message || "Invoice payment failed. Please try a different payment method.",
          400
        );
      }
    }

    const processingTimeMs = Date.now() - startTime;

    if (paidPlainInvoice.status === "paid") {
      const chargeId = typeof paidPlainInvoice.charge === "string"
        ? paidPlainInvoice.charge
        : (paidPlainInvoice.charge as any)?.id;
      const charge = chargeId ? await stripe.charges.retrieve(chargeId) : null;

      // Save to payment_history if campaign_id provided
      if (campaign_id) {
        await supabase.from("payment_history").insert({
          campaign_id,
          organization_id: organizationId,
          amount_paid: amountInCents / 100,
          currency: currency.toLowerCase(),
          stripe_charge_id: chargeId || null,
          stripe_invoice_id: paidPlainInvoice.id,
          coupon_applied: null,
          payment_type: payment_type || null,
        });
      }

      const last4 = paymentMethod.card?.last4 || "****";
      const amountInDollars = (amountInCents / 100).toFixed(2);
      const campaignText = campaign_name ? ` for campaign launch "${campaign_name}"` : "";

      await createNotification({
        supabase,
        organizationId,
        notificationType: "PAYMENT_CHARGED",
        title: "Payment Charged",
        description: `A charge of $${amountInDollars} made against ${last4} card${campaignText}`,
        targetRoles: ["ADMIN"],
        metadata: {
          invoice_id: paidPlainInvoice.id,
          payment_method_id: paymentMethod.id,
          amount: amountInCents,
          currency: currency.toLowerCase(),
          last4,
          campaign_name: campaign_name || null,
        },
      });

      const preferences = await getUserPreferences(supabase, user.userId);

      return successResponse({
        status: "success",
        message: "Payment succeeded",
        payment: {
          id: charge?.id || paidPlainInvoice.id,
          amount: amountInCents,
          currency: currency.toLowerCase(),
          amount_display: enrichCurrency(amountInCents / 100, preferences.currency),
          status: "succeeded",
          description: description || `Charge for ${org.business_name || "organization"}`,
          created: new Date(paidPlainInvoice.created * 1000).toISOString(),
          created_tz: enrichTimestamp(new Date(paidPlainInvoice.created * 1000).toISOString(), preferences.timezone),
          receipt_url: charge?.receipt_url || null,
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
    } else {
      try { await stripe.invoices.voidInvoice(plainInvoice.id); } catch (_) { /* ignore */ }
      return errorResponse("PAYMENT_ERROR", `Invoice payment status: ${paidPlainInvoice.status}`, 400);
    }

  } catch (_error) {
    const error = _error as any;
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
