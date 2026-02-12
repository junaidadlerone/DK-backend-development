import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Delete Signature By ID Edge Function
 * Deletes a specific signature record and its associated proof file from storage
 *
 * Business Rules:
 * - Requires signature ID in request body
 * - Organization-based authentication
 * - Deletes signature record from database
 * - Deletes associated proof file from Supabase Storage (if it exists)
 * - Returns success even if proof file doesn't exist (idempotent)
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow DELETE requests
  if (req.method !== "DELETE") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only DELETE method is allowed", 405);
  }

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
    let body: any;
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

    const { id } = body;

    // Validate ID
    if (!id || typeof id !== "string") {
      return errorResponse(
        "INVALID_INPUT",
        "id is required and must be a string",
        400
      );
    }

    // First, fetch the signature to get proof_id and proof_url
    const { data: signature, error: fetchError } = await supabase
      .from("signatures")
      .select("id, proof_id, proof_url")
      .eq("id", id)
      .single();

    if (fetchError) {
      if (fetchError.code === "PGRST116") {
        return errorResponse(
          "SIGNATURE_NOT_FOUND",
          "Signature not found",
          404
        );
      }
      console.error("Error fetching signature:", fetchError);
      return errorResponse(
        "SIGNATURE_FETCH_FAILED",
        "Failed to fetch signature",
        500
      );
    }

    // Delete the proof file from storage if it exists
    if (signature.proof_id) {
      // Construct the file path from proof_url or proof_id
      // The file is stored as proofs/{proof_id}.{extension}
      // We need to extract the path from the URL or construct it
      let filePath: string | null = null;

      if (signature.proof_url) {
        // Extract the path from the URL
        // URL format: https://{project}.supabase.co/storage/v1/object/public/signatures/proofs/{filename}
        const urlParts = signature.proof_url.split("/signatures/");
        if (urlParts.length > 1) {
          filePath = urlParts[1];
        }
      }

      // If we couldn't extract the path from URL, we'll need to list files and find it
      if (filePath) {
        const { error: deleteError } = await supabase
          .storage
          .from("signatures")
          .remove([filePath]);

        if (deleteError) {
          // Log the error but don't fail the operation
          // The file might already be deleted or not exist
          console.warn("Error deleting proof file (non-fatal):", deleteError);
        }
      } else {
        console.warn("Could not determine file path for proof deletion");
      }
    }

    // Delete the signature record from database
    const { error: deleteError } = await supabase
      .from("signatures")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Error deleting signature:", deleteError);
      return errorResponse(
        "DELETE_FAILED",
        "Failed to delete signature",
        500
      );
    }

    // Return success response
    return successResponse(
      {
        status: "success",
        message: "Signature deleted successfully",
        data: {
          id: signature.id
        }
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in deleteSignatureById:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});
