import {
  corsResponse,
  errorResponse,
  successResponse,
} from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Get All Fonts Edge Function
 * Returns all available Fonts from the database
 *
 * Business Rules:
 * - Returns list of all available fonts for use in branding settings
 * - User must be authenticated and in organization
 * - Fetches fonts from 'fonts' table in database
 */

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    return errorResponse(
      "METHOD_NOT_ALLOWED",
      "Only GET method is allowed",
      405,
    );
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
        401,
      );
    }

    // Get user's organization
    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403,
      );
    }

    // Fetch all fonts via pagination (PostgREST caps at 1000 rows per request)
    const allFonts: any[] = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    let fontsError = null;

    while (true) {
      const { data, error } = await supabase
        .from("fonts")
        .select("name, category, variants, subsets")
        .order("name")
        .range(from, from + PAGE_SIZE - 1);

      if (error) { fontsError = error; break; }
      if (!data || data.length === 0) break;
      allFonts.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (fontsError) {
      console.error("Error fetching fonts from database:", fontsError);
      return successResponse({
        status: "success",
        message: "Retrieved popular fonts (fallback list)",
        fonts: getPopularFonts(),
        processingTimeMs: Date.now() - startTime,
      });
    }

    // Use DB data if available, otherwise fallback
    const fonts = allFonts.length > 0 ? allFonts : getPopularFonts();

    const processingTimeMs = Date.now() - startTime;

    return successResponse({
      status: "success",
      message: `Retrieved ${fonts.length} fonts`,
      fonts: fonts,
      processingTimeMs,
    });
  } catch (error) {
    console.error("Unexpected error in getAllFonts:", error);
    return errorResponse(
      "INTERNAL_ERROR",
      `An unexpected error occurred: ${error.message}`,
      500,
    );
  }
});

/**
 * Returns a curated list of popular Google Fonts as fallback
 */
function getPopularFonts() {
  return [
    {
      name: "Poppins",
      category: "sans-serif",
      variants: ["regular", "500", "600", "700"],
      subsets: ["latin"],
    },
    {
      name: "Roboto",
      category: "sans-serif",
      variants: ["regular", "500", "700"],
      subsets: ["latin"],
    },
    {
      name: "Open Sans",
      category: "sans-serif",
      variants: ["regular", "600", "700"],
      subsets: ["latin"],
    },
    {
      name: "Lato",
      category: "sans-serif",
      variants: ["regular", "700"],
      subsets: ["latin"],
    },
    {
      name: "Montserrat",
      category: "sans-serif",
      variants: ["regular", "500", "600", "700"],
      subsets: ["latin"],
    },
    {
      name: "Oswald",
      category: "sans-serif",
      variants: ["regular", "500", "600", "700"],
      subsets: ["latin"],
    },
    {
      name: "Raleway",
      category: "sans-serif",
      variants: ["regular", "500", "600", "700"],
      subsets: ["latin"],
    },
    {
      name: "PT Sans",
      category: "sans-serif",
      variants: ["regular", "700"],
      subsets: ["latin"],
    },
    {
      name: "Merriweather",
      category: "serif",
      variants: ["regular", "700"],
      subsets: ["latin"],
    },
    {
      name: "Playfair Display",
      category: "serif",
      variants: ["regular", "700"],
      subsets: ["latin"],
    },
    {
      name: "Nunito",
      category: "sans-serif",
      variants: ["regular", "600", "700"],
      subsets: ["latin"],
    },
    {
      name: "Ubuntu",
      category: "sans-serif",
      variants: ["regular", "500", "700"],
      subsets: ["latin"],
    },
    {
      name: "Inter",
      category: "sans-serif",
      variants: ["regular", "500", "600", "700"],
      subsets: ["latin"],
    },
    {
      name: "Work Sans",
      category: "sans-serif",
      variants: ["regular", "500", "600", "700"],
      subsets: ["latin"],
    },
    {
      name: "Quicksand",
      category: "sans-serif",
      variants: ["regular", "500", "600", "700"],
      subsets: ["latin"],
    },
  ];
}
