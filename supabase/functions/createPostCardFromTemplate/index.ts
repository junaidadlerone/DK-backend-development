import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Create PostCard From Template Edge Function
 * Creates a postcard using PostGrid API with templates
 *
 * Business Rules:
 * - Requires PostGrid API key in request body
 * - Accepts both database UUID and PostGrid template IDs for frontTemplate and backTemplate
 * - Creates postcard via PostGrid API
 * - Organization-scoped (templates must belong to user's organization OR be universal templates)
 * - Universal templates (is_universal=true) are accessible to all organizations
 * - All request parameters pass through to PostGrid except template IDs are resolved
 *
 * Request body:
 * {
 *   "postgridApiKey": string (required),
 *   "to": object (required) - recipient address,
 *   "from": object (required) - sender address,
 *   "size": string (required) - postcard size,
 *   "frontTemplate": string (required) - template ID (database UUID or PostGrid ID),
 *   "backTemplate": string (required) - template ID (database UUID or PostGrid ID),
 *   "description": string (optional),
 *   "mergeVariables": object (optional) - template merge variables
 * }
 */

interface PostCardRequest {
  postgridApiKey: string;
  to: {
    firstName: string;
    lastName: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    provinceOrState: string;
    postalOrZip: string;
    countryCode: string;
  };
  from: {
    firstName?: string;
    lastName?: string;
    companyName?: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    provinceOrState: string;
    postalOrZip: string;
    countryCode: string;
  };
  size: string;
  frontTemplate: string;
  backTemplate: string;
  description?: string;
  mergeVariables?: Record<string, any>;
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

    // Parse request body
    let requestBody: PostCardRequest;
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
    const {
      postgridApiKey,
      to,
      from,
      size,
      frontTemplate,
      backTemplate,
      description,
      mergeVariables
    } = requestBody;

    if (!postgridApiKey || typeof postgridApiKey !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "postgridApiKey is required and must be a string",
        400
      );
    }

    if (!to || typeof to !== 'object') {
      return errorResponse(
        "INVALID_INPUT",
        "to address is required and must be an object",
        400
      );
    }

    if (!from || typeof from !== 'object') {
      return errorResponse(
        "INVALID_INPUT",
        "from address is required and must be an object",
        400
      );
    }

    if (!size || typeof size !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "size is required and must be a string",
        400
      );
    }

    if (!frontTemplate || typeof frontTemplate !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "frontTemplate is required and must be a string",
        400
      );
    }

    if (!backTemplate || typeof backTemplate !== 'string') {
      return errorResponse(
        "INVALID_INPUT",
        "backTemplate is required and must be a string",
        400
      );
    }

    // Helper function to check if string is a valid UUID
    function isUUID(str: string): boolean {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(str);
    }

    // Helper function to get PostGrid template ID
    async function getPostGridTemplateId(templateId: string, templateType: string): Promise<{ postgridId?: string; error?: any }> {
      const isDbId = isUUID(templateId);

      // If it's not a UUID, assume it's already a PostGrid template ID
      if (!isDbId) {
        // Still verify it exists in our database and belongs to organization OR is universal
        const { data: template, error: templateError } = await supabase
          .from("templates")
          .select("postgrid_template_id, deleted")
          .eq("postgrid_template_id", templateId)
          .or(`organization_id.eq.${organizationId},is_universal.eq.true`)
          .single();

        if (templateError || !template) {
          return {
            error: errorResponse(
              "TEMPLATE_NOT_FOUND",
              `${templateType} template not found`,
              404
            )
          };
        }

        if (template.deleted) {
          return {
            error: errorResponse(
              "TEMPLATE_DELETED",
              `${templateType} template has been deleted`,
              410
            )
          };
        }

        return { postgridId: templateId };
      }

      // It's a database UUID, look it up
      const { data: template, error: templateError } = await supabase
        .from("templates")
        .select("postgrid_template_id, deleted")
        .eq("id", templateId)
        .or(`organization_id.eq.${organizationId},is_universal.eq.true`)
        .single();

      if (templateError || !template) {
        return {
          error: errorResponse(
            "TEMPLATE_NOT_FOUND",
            `${templateType} template not found`,
            404
          )
        };
      }

      if (template.deleted) {
        return {
          error: errorResponse(
            "TEMPLATE_DELETED",
            `${templateType} template has been deleted`,
            410
          )
        };
      }

      return { postgridId: template.postgrid_template_id };
    }

    // Resolve template IDs
    const frontResult = await getPostGridTemplateId(frontTemplate, "Front");
    if (frontResult.error) return frontResult.error;
    const frontPostGridId = frontResult.postgridId;

    const backResult = await getPostGridTemplateId(backTemplate, "Back");
    if (backResult.error) return backResult.error;
    const backPostGridId = backResult.postgridId;

    // Convert size format from database format (4x6, 6x9, 6x11) to PostGrid format (6x4, 9x6, 11x6)
    const sizeMap: Record<string, string> = {
      '4x6': '6x4',
      '6x9': '9x6',
      '6x11': '11x6',
      // Also support PostGrid format directly
      '6x4': '6x4',
      '9x6': '9x6',
      '11x6': '11x6'
    };

    const postgridSize = sizeMap[size];
    if (!postgridSize) {
      return errorResponse(
        "INVALID_SIZE",
        `Invalid size. Must be one of: 4x6, 6x9, 6x11 (or PostGrid format: 6x4, 9x6, 11x6)`,
        400
      );
    }

    // Build PostGrid API request body
    const postgridRequestBody: any = {
      to,
      from,
      size: postgridSize,
      frontTemplate: frontPostGridId,
      backTemplate: backPostGridId
    };

    if (description) {
      postgridRequestBody.description = description;
    }

    if (mergeVariables && typeof mergeVariables === 'object') {
      postgridRequestBody.mergeVariables = mergeVariables;
    }

    // Call PostGrid API to create postcard
    let postgridResponse: Response;
    try {
      postgridResponse = await fetch('https://api.postgrid.com/print-mail/v1/postcards', {
        method: 'POST',
        headers: {
          'x-api-key': postgridApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(postgridRequestBody)
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
        postgridResponse.status
      );
    }

    let postcardData: any;
    try {
      postcardData = await postgridResponse.json();
    } catch (jsonError) {
      console.error("Error parsing PostGrid response:", jsonError);
      return errorResponse(
        "POSTGRID_RESPONSE_ERROR",
        "Failed to parse PostGrid API response",
        500
      );
    }

    const processingTimeMs = Date.now() - startTime;

    // Build response
    const response = {
      status: "success",
      message: "Postcard created successfully",
      postcard: postcardData,
      processingTimeMs
    };

    return successResponse(response, 201);

  } catch (error) {
    console.error("Unexpected error in createPostCardFromTemplate:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500
    );
  }
});
