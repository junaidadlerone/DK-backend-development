import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

/**
 * Initialize Stripe client with secret key
 *
 * @param isTestMode - If true, use test keys; otherwise use production keys
 */
export function createStripeClient(isTestMode = false): Stripe {
  const stripeSecretKey = isTestMode
    ? Deno.env.get("STRIPE_TEST_SECRET_KEY")
    : Deno.env.get("STRIPE_SECRET_KEY");

  if (!stripeSecretKey) {
    const keyType = isTestMode ? "STRIPE_TEST_SECRET_KEY" : "STRIPE_SECRET_KEY";
    throw new Error(`${keyType} environment variable is not set`);
  }

  return new Stripe(stripeSecretKey, {
    apiVersion: "2024-11-20.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/**
 * Get or create Stripe customer for an organization
 *
 * @param supabase - Supabase client
 * @param organizationId - Organization UUID
 * @param isTestMode - If true, use test keys; otherwise use production keys
 * @returns Stripe customer ID
 */
export async function getOrCreateStripeCustomer(
  supabase: any,
  organizationId: string,
  isTestMode = false
): Promise<string> {
  // Check if organization already has a Stripe customer ID
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("stripe_customer_id, business_name, business_email")
    .eq("id", organizationId)
    .single();

  if (orgError) {
    throw new Error(`Failed to fetch organization: ${orgError.message}`);
  }

  // Return existing customer ID if it exists
  if (org.stripe_customer_id) {
    return org.stripe_customer_id;
  }

  // Create new Stripe customer
  const stripe = createStripeClient(isTestMode);

  const customer = await stripe.customers.create({
    email: org.business_email || undefined,
    name: org.business_name || undefined,
    metadata: {
      organization_id: organizationId,
    },
  });

  // Save customer ID to database
  const { error: updateError } = await supabase
    .from("organizations")
    .update({ stripe_customer_id: customer.id })
    .eq("id", organizationId);

  if (updateError) {
    console.error("Failed to save Stripe customer ID:", updateError);
    // Don't throw - customer was created in Stripe successfully
  }

  return customer.id;
}

/**
 * Verify Stripe webhook signature
 *
 * @param payload - Raw request body
 * @param signature - Stripe signature header
 * @param isTestMode - If true, use test webhook secret; otherwise use production
 * @returns Stripe event object
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  isTestMode = false
): Stripe.Event {
  const stripe = createStripeClient(isTestMode);
  const webhookSecret = isTestMode
    ? Deno.env.get("STRIPE_TEST_WEBHOOK_SECRET")
    : Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!webhookSecret) {
    const secretType = isTestMode ? "STRIPE_TEST_WEBHOOK_SECRET" : "STRIPE_WEBHOOK_SECRET";
    throw new Error(`${secretType} environment variable is not set`);
  }

  try {
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (err) {
    throw new Error(`Webhook signature verification failed: ${err.message}`);
  }
}
