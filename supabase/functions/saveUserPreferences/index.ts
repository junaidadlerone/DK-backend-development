import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";

/**
 * Save User Preferences Edge Function
 * Saves or updates user's system preferences (timezone and currency)
 *
 * Business Rules:
 * - Requires authentication
 * - Preferences are user-specific (not organization-based)
 * - Updates existing preferences or creates new ones
 *
 * Request body:
 * {
 *   "selected_timezone_id": "uuid",
 *   "selected_currency_id": "uuid"
 * }
 */

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return errorResponse(
      "METHOD_NOT_ALLOWED",
      "Only POST requests are allowed",
      405
    );
  }

  try {
    // Parse request body
    let body;
    try {
      body = await req.json();
    } catch {
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON format in request body",
        400
      );
    }

    const { selected_timezone_id, selected_currency_id } = body;

    // Validate required fields
    if (!selected_timezone_id || !selected_currency_id) {
      return errorResponse(
        "MISSING_FIELDS",
        "Both selected_timezone_id and selected_currency_id are required",
        400
      );
    }

    // Create Supabase client
    const supabase = createSupabaseClient();

    // Get user from request
    const user = getUserFromRequest(req);
    if (!user) {
      return errorResponse(
        "UNAUTHORIZED",
        "Authentication required",
        401
      );
    }

    // Verify timezone exists
    const { data: timezone, error: timezoneError } = await supabase
      .from("timezones")
      .select("id")
      .eq("id", selected_timezone_id)
      .single();

    if (timezoneError || !timezone) {
      return errorResponse(
        "INVALID_TIMEZONE",
        "Invalid timezone ID",
        400
      );
    }

    // Verify currency exists
    const { data: currency, error: currencyError } = await supabase
      .from("currencies")
      .select("id")
      .eq("id", selected_currency_id)
      .single();

    if (currencyError || !currency) {
      return errorResponse(
        "INVALID_CURRENCY",
        "Invalid currency ID",
        400
      );
    }

    // Upsert user preferences
    const { data: preferences, error: upsertError } = await supabase
      .from("system_preferences")
      .upsert({
        user_id: user.userId,
        selected_timezone_id,
        selected_currency_id,
        updated_at: new Date().toISOString()
      }, {
        onConflict: "user_id"
      })
      .select()
      .single();

    if (upsertError) {
      console.error("Error saving preferences:", upsertError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to save preferences",
        500
      );
    }

    return successResponse({
      message: "Preferences saved successfully",
      preferences
    }, 200);

  } catch (error) {
    console.error("Unexpected error in saveUserPreferences:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
