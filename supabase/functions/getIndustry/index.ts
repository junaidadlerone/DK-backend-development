import { corsResponse, successResponse } from "../_shared/response.ts";

/**
 * Get Industry Edge Function
 * Returns a list of all available business industries
 *
 * Business Rules:
 * - Public endpoint - no authentication required
 * - Returns predefined list of industries for dropdown selection
 * - Used when users are filling out their organization details
 */

// Predefined list of business industries
const industries = [
  "Accounting",
  "Advertising & Marketing",
  "Aerospace & Defense",
  "Agriculture & Farming",
  "Architecture & Planning",
  "Automotive",
  "Banking & Financial Services",
  "Biotechnology",
  "Construction",
  "Consulting",
  "Consumer Electronics",
  "Consumer Goods",
  "E-commerce",
  "Education & Training",
  "Energy & Utilities",
  "Engineering",
  "Entertainment & Media",
  "Environmental Services",
  "Fashion & Apparel",
  "Food & Beverage",
  "Government & Public Sector",
  "Healthcare & Medical",
  "Hospitality & Tourism",
  "Human Resources",
  "Information Technology",
  "Insurance",
  "Legal Services",
  "Logistics & Supply Chain",
  "Manufacturing",
  "Mining & Metals",
  "Non-Profit & NGO",
  "Oil & Gas",
  "Pharmaceuticals",
  "Real Estate",
  "Retail",
  "Security Services",
  "Software Development",
  "Sports & Recreation",
  "Telecommunications",
  "Transportation",
  "Other",
];

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({
        error: "METHOD_NOT_ALLOWED",
        message: "Only GET method is allowed",
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  try {
    // Return the list of industries
    return successResponse(
      {
        status: "success",
        data: {
          industries: industries.sort(), // Sort alphabetically for better UX
          total: industries.length,
        },
      },
      200
    );
  } catch (error) {
    console.error("Unexpected error in getIndustry:", error);

    return new Response(
      JSON.stringify({
        error: "INTERNAL_ERROR",
        message: "An unexpected error occurred. Please try again later.",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
});
