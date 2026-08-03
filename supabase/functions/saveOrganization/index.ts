import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import {
  createSupabaseClient,
  isValidEmail,
} from "../_shared/client.ts";
import type { SaveOrganizationRequest } from "../_shared/types.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Save Organization Edge Function
 * Allows ADMIN users to update their organization information
 *
 * Business Rules:
 * - Only authenticated users can access this endpoint
 * - Users can only update their own organization (where they are the owner)
 * - business_name, business_address, and business_email are mandatory
 * - Other fields are optional
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

  try {
    // Create Supabase client
    const supabase = createSupabaseClient();

    // Get the authorization header
    const authHeader = req.headers.get("Authorization");

    if (!authHeader) {
      return errorResponse(
        "UNAUTHORIZED",
        "Authorization header is required",
        401
      );
    }

    // Extract the JWT token
    const token = authHeader.replace("Bearer ", "");

    // Verify the token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return errorResponse(
        "INVALID_TOKEN",
        "Invalid or expired token",
        401
      );
    }

    // Parse request body
    const body = await req.json() as SaveOrganizationRequest;
    const {
      business_name,
      registration_number,
      industry,
      business_address,
      business_email,
      phone_number,
      website_url,
    } = body;

    // Validate required fields
    if (!business_name || !business_address || !business_email) {
      return errorResponse(
        "INVALID_INPUT",
        "business_name, business_address, and business_email are required",
        400
      );
    }

    // Validate business email format
    if (!isValidEmail(business_email)) {
      return errorResponse(
        "INVALID_EMAIL",
        "Invalid business email format",
        400
      );
    }

    // Check if user's organization exists
    const { data: existingOrg, error: fetchError } = await supabase
      .from("organizations")
      .select("id")
      .eq("owner_id", user.id);

    if (fetchError || !existingOrg) {
      return errorResponse(
        "NO_ORGANIZATION_FOUND",
        "User has no organization. Create an organization first.",
        404
      );
    }

    const organization_id = await getUserOrganizationId(supabase, user.id); 

    // Update the organization
    // MERGE, don't full-replace (2026-07-31). This used to write every optional column with
    // `value || null`, so ANY caller that omitted a field silently erased it:
    //   - the app's own Settings form never sends registration_number at all, so every manual
    //     Save wiped it;
    //   - the assistant sends only the fields the user mentioned, so "change our business email"
    //     blanked the phone number, website, industry and registration number — with no warning,
    //     and (being a non-destructive tool) with no confirmation card.
    // Rule now: a field is only written when the caller actually sent the key. An explicit `null`
    // still clears it, so deliberate "remove my website" continues to work — callers that clear a
    // field must send null rather than omitting it (the app does; see OrganizationTab).
    const updates: Record<string, unknown> = {
      business_name,
      business_address,
      business_email,
    };
    const optionalFields = [
      "registration_number",
      "industry",
      "phone_number",
      "website_url",
    ] as const;
    const sent = body as unknown as Record<string, unknown>;
    for (const field of optionalFields) {
      if (!(field in sent)) continue;                 // not sent → leave the stored value alone
      const value = sent[field];
      if (value === undefined) continue;              // sent as undefined → same as not sent
      updates[field] = value === null || value === "" ? null : value;
    }

    const { data: updatedOrg, error: updateError } = await supabase
      .from("organizations")
      .update(updates)
      .eq("id", organization_id)
      .select()
      .single();

    if (updateError) {
      console.error("Organization update error:", updateError);
      return errorResponse(
        "UPDATE_FAILED",
        "Failed to update organization",
        500
      );
    }

    // Return success response
    return successResponse({
      status: "success",
      message: "Organization updated successfully",
      data: updatedOrg,
    }, 200);

  } catch (error) {
    console.error("Unexpected error in saveOrganization:", error);

    // Don't leak internal error details to the client
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
