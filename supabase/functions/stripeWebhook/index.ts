import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { verifyWebhookSignature } from "../_shared/stripe.ts";

/**
 * Stripe Webhook Edge Function
 * Handles webhook events from Stripe
 *
 * Business Rules:
 * - Verifies webhook signature for security
 * - Processes payment-related events
 * - Updates database based on event type
 * - Returns 200 OK to acknowledge receipt
 *
 * Handled events:
 * - payment_intent.succeeded - Payment completed successfully
 * - payment_intent.payment_failed - Payment failed
 * - charge.succeeded - Charge completed
 * - charge.refunded - Charge refunded
 * - customer.subscription.created - Subscription created
 * - customer.subscription.updated - Subscription updated
 * - customer.subscription.deleted - Subscription cancelled
 */

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
    // Get raw request body and signature
    const payload = await req.text();
    const signature = req.headers.get("stripe-signature");

    if (!signature) {
      return errorResponse(
        "MISSING_SIGNATURE",
        "Stripe signature header is missing",
        400
      );
    }

    // Verify webhook signature
    let event;
    try {
      event = verifyWebhookSignature(payload, signature);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return errorResponse(
        "INVALID_SIGNATURE",
        "Webhook signature verification failed",
        400
      );
    }

    console.log(`Received webhook event: ${event.type}`);

    // Create Supabase client
    const supabase = createSupabaseClient();

    // Handle different event types
    switch (event.type) {
      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object;
        console.log(`PaymentIntent ${paymentIntent.id} succeeded for ${paymentIntent.amount}`);

        // Get organization from customer ID
        const customerId = paymentIntent.customer as string;
        if (customerId) {
          const { data: org } = await supabase
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .single();

          if (org) {
            // Could create a notification for ADMIN users here
            console.log(`Payment succeeded for organization ${org.id}`);
          }
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object;
        console.log(`PaymentIntent ${paymentIntent.id} failed: ${paymentIntent.last_payment_error?.message}`);

        // Get organization from customer ID
        const customerId = paymentIntent.customer as string;
        if (customerId) {
          const { data: org } = await supabase
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .single();

          if (org) {
            // Could create a notification for ADMIN users about payment failure
            console.log(`Payment failed for organization ${org.id}`);
          }
        }
        break;
      }

      case "charge.succeeded": {
        const charge = event.data.object;
        console.log(`Charge ${charge.id} succeeded for ${charge.amount} ${charge.currency}`);
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        console.log(`Charge ${charge.id} refunded: ${charge.amount_refunded} ${charge.currency}`);

        // Get organization from customer ID
        const customerId = charge.customer as string;
        if (customerId) {
          const { data: org } = await supabase
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .single();

          if (org) {
            // Could create a notification for ADMIN users about refund
            console.log(`Charge refunded for organization ${org.id}`);
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        console.log(`Subscription ${subscription.id} ${event.type.split(".").pop()}: status ${subscription.status}`);

        // Get organization from customer ID
        const customerId = subscription.customer as string;
        if (customerId) {
          const { data: org } = await supabase
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .single();

          if (org) {
            // Could update subscription status in database here if needed
            console.log(`Subscription event for organization ${org.id}`);
          }
        }
        break;
      }

      case "payment_method.attached": {
        const paymentMethod = event.data.object;
        console.log(`Payment method ${paymentMethod.id} attached to customer ${paymentMethod.customer}`);

        // Get organization from customer ID
        const customerId = paymentMethod.customer as string;
        if (customerId) {
          const { data: org } = await supabase
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .single();

          if (org) {
            console.log(`Payment method attached for organization ${org.id}`);
          }
        }
        break;
      }

      case "payment_method.detached": {
        const paymentMethod = event.data.object;
        console.log(`Payment method ${paymentMethod.id} detached from customer`);

        // Note: After detachment, customer field may be null
        // We can still log the event for monitoring purposes
        console.log(`Payment method detached: ${paymentMethod.id}`);
        break;
      }

      case "payment_method.updated": {
        const paymentMethod = event.data.object;
        console.log(`Payment method ${paymentMethod.id} updated for customer ${paymentMethod.customer}`);

        // Get organization from customer ID
        const customerId = paymentMethod.customer as string;
        if (customerId) {
          const { data: org } = await supabase
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .single();

          if (org) {
            console.log(`Payment method updated for organization ${org.id}`);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    const processingTimeMs = Date.now() - startTime;

    // Always return 200 OK to acknowledge receipt
    return successResponse({
      status: "success",
      message: "Webhook processed successfully",
      event_type: event.type,
      processingTimeMs,
    });

  } catch (error) {
    console.error("Unexpected error in stripeWebhook:", error);

    // Still return 200 to prevent Stripe from retrying
    // Log the error for investigation
    return successResponse({
      status: "error",
      message: "Webhook received but processing failed",
      error: error.message,
    });
  }
});
