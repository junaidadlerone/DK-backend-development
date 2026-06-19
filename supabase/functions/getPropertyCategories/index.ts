import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { getUserFromRequest } from "../_shared/history.ts";

/**
 * getPropertyCategories — return the property category / subcategory taxonomy
 * used by the address-discovery UI.
 *
 * RentCast's `propertyType` field is a flat enum; this endpoint imposes a
 * 2-level grouping (Residential / Commercial / Land) on top so the frontend
 * can render a familiar category-then-subcategory picker.
 *
 * Each subcategory carries `rentcast_type` — the exact value RentCast returns
 * on its property rows. The frontend echoes one or more `subcategory_ids` to
 * the `discoveraddresses` WebSocket when initiating a search; the server then
 * filters RentCast results to `property.propertyType === rentcast_type`.
 *
 * Response is static and cacheable. Light auth gate (JWT required) so that
 * unauthenticated callers can't enumerate the taxonomy.
 */

const CATEGORIES = [
  {
    id: "residential",
    label: "Residential",
    subcategories: [
      { id: "single_family", label: "Single Family Home", rentcast_type: "Single Family" },
      { id: "condo",         label: "Condo",              rentcast_type: "Condo" },
      { id: "townhouse",     label: "Townhouse",          rentcast_type: "Townhouse" },
      { id: "multi_family",  label: "Multi-Family",       rentcast_type: "Multi-Family" },
      { id: "apartment",     label: "Apartment",          rentcast_type: "Apartment" },
      { id: "manufactured",  label: "Manufactured",       rentcast_type: "Manufactured" },
    ],
  },
  {
    id: "commercial",
    label: "Commercial",
    subcategories: [
      { id: "industrial", label: "Industrial", rentcast_type: "Industrial" },
      { id: "commercial", label: "Commercial", rentcast_type: "Commercial" },
      { id: "retail",     label: "Retail",     rentcast_type: "Retail" },
      { id: "office",     label: "Office",     rentcast_type: "Office" },
    ],
  },
  {
    id: "land",
    label: "Land",
    subcategories: [
      { id: "land", label: "Land / Lot", rentcast_type: "Land" },
    ],
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  // Minimal auth gate — must have a valid bearer token.
  const user = getUserFromRequest(req);
  if (!user) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

  return successResponse({
    status: "success",
    data: CATEGORIES,
  }, 200);
});
