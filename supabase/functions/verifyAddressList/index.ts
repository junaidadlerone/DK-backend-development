import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";

/**
 * Verify Address List Edge Function
 * Performs batch verification for a specific CSV address list.
 */

interface AddressRow {
  name?: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  status?: string;
  verified?: boolean;
  verification_details?: Record<string, unknown>;
}

// Reuse parsing logic from standard verification
function _parseAddress(formattedAddress: string) {
    const parts = formattedAddress.split(",").map(p => p.trim());
    if (parts.length >= 3) {
        return {
            line1: parts[0],
            city: parts[1],
            provinceOrState: parts[2].split(" ")[0],
            postalOrZip: parts[2].split(" ").slice(1).join(" "),
            country: "US"
        };
    }
    return { line1: formattedAddress, city: "", provinceOrState: "", postalOrZip: "", country: "US" };
}

async function verifyWithPostGrid(address: AddressRow, postgridApiKey: string) {
    try {
        const payload = {
            address: {
                line1: address.address_line1,
                line2: address.address_line2 || "",
                city: address.city,
                provinceOrState: address.state,
                postalOrZip: address.zip,
                country: "US"
            }
        };

        const response = await fetch("https://api.postgrid.com/v1/addver/verifications", {
            method: "POST",
            headers: {
                "x-api-key": postgridApiKey,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) return { ...address, verified: false, status: "Invalid" };

        const result = await response.json();
        const data = result.data;
        const verified = data.status === "verified" || data.status === "corrected";

        return {
            ...address,
            address_line1: data.line1,
            city: data.city,
            state: data.provinceOrState,
            zip: data.postalOrZip,
            verified,
            status: verified ? "Valid" : "Invalid",
            verification_details: data
        };
    } catch {
        return { ...address, verified: false, status: "Error" };
    }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);
    if (!user) return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);

    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) return errorResponse("NO_ORGANIZATION", "User is not associated with any organization", 403);

    const postgridApiKey = Deno.env.get("POSTGRID_API_KEY");
    if (!postgridApiKey) return errorResponse("MISSING_API_KEY", "POSTGRID_API_KEY not set", 500);

    const { list_id } = await req.json();
    if (!list_id) return errorResponse("INVALID_INPUT", "list_id is required", 400);

    // 1. Fetch the list
    const { data: list, error: fetchError } = await supabase
      .from("campaign_csv_address_lists")
      .select("*")
      .eq("id", list_id)
      .eq("organization_id", organizationId)
      .single();

    if (fetchError || !list) return errorResponse("NOT_FOUND", "Address list not found", 404);

    const addresses = list.addresses || [];
    const BATCH_SIZE = 20;
    const verifiedResults: AddressRow[] = [];

    // 2. Batch Verification
    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
      const batch = addresses.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map((addr: AddressRow) => verifyWithPostGrid(addr, postgridApiKey));
      const results = await Promise.all(batchPromises);
      verifiedResults.push(...results);
    }

    // 3. Update Record
    const verifiedCount = verifiedResults.filter(r => r.verified).length;
    const historyEntry = {
        event: "VERIFICATION_COMPLETED",
        timestamp: new Date().toISOString(),
        details: { verified_count: verifiedCount, total_count: verifiedResults.length }
    };

    const { error: updateError } = await supabase
      .from("campaign_csv_address_lists")
      .update({
        addresses: verifiedResults,
        status: "Ready",
        operation_history: [...(list.operation_history || []), historyEntry],
        metadata: { ...list.metadata, verified_count: verifiedCount }
      })
      .eq("id", list_id);

    if (updateError) throw updateError;

    return successResponse({
      status: "success",
      message: `Verified ${verifiedCount} of ${verifiedResults.length} addresses`,
      data: { verified_count: verifiedCount }
    });

  } catch (error) {
    console.error("Error in verifyAddressList:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
