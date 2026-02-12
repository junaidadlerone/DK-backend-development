import { corsResponse, successResponse } from "../_shared/response.ts";

/**
 * Keep Alive Edge Function
 * Pings critical functions to keep them warm and prevent cold starts
 *
 * This function should be called by a cron job every 5 minutes
 *
 * Critical functions to keep warm:
 * - login
 * - signUp
 * - getAllCampaigns
 * - getAddressesFromZone
 * - createCampaign
 * - getAnalytics
 */

const CRITICAL_FUNCTIONS = [
  "login",
  "signUp",
  "getAllCampaigns",
  "getAddressesFromZone",
  "createCampaign",
  "getAnalytics"
];

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  try {
    const baseUrl = Deno.env.get("SUPABASE_URL");
    const results: Record<string, string> = {};

    // Ping each critical function with OPTIONS request (lightweight)
    for (const functionName of CRITICAL_FUNCTIONS) {
      try {
        const startTime = Date.now();
        const response = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
          method: "OPTIONS",
          headers: {
            "Origin": "https://keep-alive"
          }
        });

        const duration = Date.now() - startTime;
        results[functionName] = response.ok
          ? `✓ ${duration}ms`
          : `✗ ${response.status} ${duration}ms`;
      } catch (error) {
        results[functionName] = `✗ Error: ${error.message}`;
      }
    }

    return successResponse({
      status: "success",
      message: "Keep-alive ping completed",
      timestamp: new Date().toISOString(),
      results
    }, 200);

  } catch (error) {
    console.error("Error in keepAlive:", error);
    return successResponse({
      status: "partial_success",
      message: "Keep-alive completed with errors",
      error: error.message
    }, 200);
  }
});
