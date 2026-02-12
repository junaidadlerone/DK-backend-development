import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, isAdmin } from "../_shared/client.ts";
import { getUserFromRequest, getUserProfile } from "../_shared/history.ts";
import { logTemplateHistory } from "../_shared/templateHistory.ts";

/**
 * Create New Universal Template Edge Function
 * Creates a PostGrid template and saves it as a universal template visible to all organizations
 *
 * Business Rules:
 * - Only ADMIN users can create universal templates
 * - Requires PostGrid API key in request body
 * - Creates template in PostGrid using their API
 * - Saves template metadata to templates table with is_universal=true
 * - Template has no organization restrictions (organization_id is null)
 * - Visible to all organizations via getAllTemplates
 * - Tracks creator via createdBy field
 * - Initializes empty campaigns_used array
 *
 * Request body:
 * {
 *   "postgridApiKey": string (required),
 *   "description": string (required),
 *   "html": string (required),
 *   "templateType": "Front" | "Back" (required),
 *   "postcardSize": "4x6" | "6x9" | "6x11" (required)
 * }
 */

interface RequestBody {
  postgridApiKey: string;
  description: string;
  html: string;
  templateType: 'Front' | 'Back';
  postcardSize: '4x6' | '6x9' | '6x11';
}

interface PostGridTemplateResponse {
  id: string;
  object: string;
  live: boolean;
  deleted: boolean;
  description: string;
  html: string;
  createdAt: string;
  updatedAt: string;
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

    // Check if the authenticated user is an admin
    const isUserAdmin = await isAdmin(user.userId);
    if (!isUserAdmin) {
      return errorResponse(
        "FORBIDDEN",
        "Only ADMIN users can create universal templates",
        403
      );
    }

    // Get user profile for createdBy field
    const userProfile = await getUserProfile(supabase, user.userId);
    if (!userProfile) {
      return errorResponse(
        "USER_PROFILE_NOT_FOUND",
        "User profile not found",
        404
      );
    }

    // Parse request body
    let requestBody: RequestBody;
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
    const { postgridApiKey, description, html, templateType, postcardSize } = requestBody;

    if (!postgridApiKey || typeof postgridApiKey !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "postgridApiKey is required and must be a string",
        400
      );
    }

    if (!description || typeof description !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "description is required and must be a string",
        400
      );
    }

    if (!html || typeof html !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "html is required and must be a string",
        400
      );
    }

    if (!templateType || !['Front', 'Back'].includes(templateType)) {
      return errorResponse(
        "INVALID_INPUT",
        "templateType is required and must be either 'Front' or 'Back'",
        400
      );
    }

    if (!postcardSize || !['4x6', '6x9', '6x11'].includes(postcardSize)) {
      return errorResponse(
        "INVALID_INPUT",
        "postcardSize is required and must be one of: '4x6', '6x9', '6x11'",
        400
      );
    }

    // Create template in PostGrid
    const formData = new URLSearchParams();
    formData.append('description', description);
    formData.append('html', html);

    let postgridResponse: Response;
    try {
      postgridResponse = await fetch('https://api.postgrid.com/print-mail/v1/templates', {
        method: 'POST',
        headers: {
          'x-api-key': postgridApiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData.toString()
      });
    } catch (fetchError) {
      console.error("Error calling PostGrid API:", fetchError);
      return errorResponse(
        "POSTGRID_API_ERROR",
        "Failed to connect to PostGrid API",
        500
      );
    }

    if (!postgridResponse.ok) {
      const errorText = await postgridResponse.text();
      console.error("PostGrid API error:", errorText);
      return errorResponse(
        "POSTGRID_API_ERROR",
        `PostGrid API returned error: ${postgridResponse.status} - ${errorText}`,
        500
      );
    }

    let postgridTemplate: PostGridTemplateResponse;
    try {
      postgridTemplate = await postgridResponse.json();
    } catch (jsonError) {
      console.error("Error parsing PostGrid response:", jsonError);
      return errorResponse(
        "POSTGRID_RESPONSE_ERROR",
        "Failed to parse PostGrid API response",
        500
      );
    }

    // Save universal template to database (organization_id is null)
    const { data: templateData, error: insertError } = await supabase
      .from("templates")
      .insert({
        organization_id: null, // Universal template has no organization
        is_universal: true,
        postgrid_template_id: postgridTemplate.id,
        description: postgridTemplate.description,
        html: postgridTemplate.html,
        template_type: templateType,
        postcard_size: postcardSize,
        campaigns_used: [],
        created_by: userProfile,
        live: postgridTemplate.live,
        deleted: postgridTemplate.deleted
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error saving template to database:", insertError);
      return errorResponse(
        "DATABASE_ERROR",
        "Failed to save template to database",
        500
      );
    }

    // Log template creation history
    await logTemplateHistory(
      supabase,
      templateData.id,
      user.userId,
      user.userName,
      `created universal template (${templateType}, ${postcardSize})`
    );

    const processingTimeMs = Date.now() - startTime;

    // Build response
    const response = {
      status: "success",
      message: "Universal template created successfully",
      template: {
        id: templateData.id,
        postgrid_template_id: templateData.postgrid_template_id,
        description: templateData.description,
        html: templateData.html,
        templateType: templateData.template_type,
        postcardSize: templateData.postcard_size,
        isUniversal: templateData.is_universal,
        campaigns_used: templateData.campaigns_used,
        createdBy: templateData.created_by,
        live: templateData.live,
        deleted: templateData.deleted,
        created_at: templateData.created_at,
        updated_at: templateData.updated_at
      },
      processingTimeMs
    };

    return successResponse(response, 201);

  } catch (error) {
    console.error("Unexpected error in createNewUniversalTemplate:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
