import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Update Branding Settings Edge Function
 * Updates user-specific branding settings (theme colors and fonts)
 *
 * Business Rules:
 * - Settings are user-specific (not organization-wide)
 * - Updates theme colors and fonts
 * - Validates color format (hex colors)
 * - User must be authenticated and in organization
 *
 * Request body:
 * {
 *   "theme": {
 *     "colors": {
 *       "primary": "#E36A00",
 *       "secondary": "#1D1D20",
 *       "accent": "#47BAD7"
 *     },
 *     "fonts": {
 *       "primary": {
 *         "name": "Poppins"
 *       },
 *       "body": {
 *         "name": "Poppins"
 *       }
 *     }
 *   }
 * }
 */

interface BrandingSettings {
  theme: {
    colors: {
      primary: string;
      secondary: string;
      accent: string;
    };
    fonts: {
      primary: {
        name: string;
      };
      body: {
        name: string;
      };
    };
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow POST or PATCH requests
  if (req.method !== "POST" && req.method !== "PATCH") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST and PATCH methods are allowed", 405);
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

    // Parse request body
    let requestBody: BrandingSettings;
    try {
      requestBody = await req.json();
    } catch (parseError) {
      return errorResponse(
        "INVALID_INPUT",
        "Invalid JSON in request body",
        400
      );
    }

    // Validate required fields
    const { theme } = requestBody;

    if (!theme || typeof theme !== 'object') {
      return errorResponse(
        "INVALID_INPUT",
        "theme object is required",
        400
      );
    }

    if (!theme.colors || typeof theme.colors !== 'object') {
      return errorResponse(
        "INVALID_INPUT",
        "theme.colors object is required",
        400
      );
    }

    if (!theme.fonts || typeof theme.fonts !== 'object') {
      return errorResponse(
        "INVALID_INPUT",
        "theme.fonts object is required",
        400
      );
    }

    // Validate colors
    const { primary, secondary, accent } = theme.colors;

    if (!primary || !isValidHexColor(primary)) {
      return errorResponse(
        "INVALID_INPUT",
        "primary color must be a valid hex color (e.g., #E36A00)",
        400
      );
    }

    if (!secondary || !isValidHexColor(secondary)) {
      return errorResponse(
        "INVALID_INPUT",
        "secondary color must be a valid hex color (e.g., #1D1D20)",
        400
      );
    }

    if (!accent || !isValidHexColor(accent)) {
      return errorResponse(
        "INVALID_INPUT",
        "accent color must be a valid hex color (e.g., #47BAD7)",
        400
      );
    }

    // Validate fonts
    if (!theme.fonts.primary || !theme.fonts.primary.name) {
      return errorResponse(
        "INVALID_INPUT",
        "primary font name is required",
        400
      );
    }

    if (!theme.fonts.body || !theme.fonts.body.name) {
      return errorResponse(
        "INVALID_INPUT",
        "body font name is required",
        400
      );
    }

    // Update branding settings in user profile
    const { data: updatedProfile, error: updateError } = await supabase
      .from("profiles")
      .update({
        branding_settings: requestBody,
        updated_at: new Date().toISOString()
      })
      .eq("id", user.userId)
      .select("id, branding_settings")
      .single();

    if (updateError) {
      console.error("Error updating branding settings:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to update branding settings",
        500
      );
    }

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      message: "Branding settings updated successfully",
      branding_settings: updatedProfile.branding_settings,
      processingTimeMs
    }, 200);

  } catch (error) {
    console.error("Unexpected error in updateBrandingSettings:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});

/**
 * Validates if a string is a valid hex color
 */
function isValidHexColor(color: string): boolean {
  const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  return hexColorRegex.test(color);
}
