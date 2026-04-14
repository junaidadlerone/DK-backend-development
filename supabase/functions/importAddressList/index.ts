import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { parse } from "https://deno.land/std@0.224.0/csv/parse.ts";
import { AddressRow, AddressListMetadata as _AddressListMetadata } from "../_shared/addressLists.ts";

/**
 * Import Address List Edge Function
 * Standardizes, verifies, and ingests CSV-based address lists.
 * 
 * Performs:
 * 1. CSV Parsing (Column Convention matching PoC)
 * 2. Deduplication (Internal)
 * 3. Address Verification (PostGrid API)
 * 4. DB Persistence (Optional but recommended for consistency)
 *
 * Request Body:
 * {
 *   "campaign_id": "uuid" (optional),
 *   "list_name": "String",
 *   "csv_data": "base64_encoded_string_or_raw_string_or_csv_file",
 *   "filename": "original_filename.csv"
 * }
 */

interface CSVAddressRow {
    "Address Line 1": string;
    "Address Line 2"?: string;
    "City": string;
    "State": string;
    "Zip Code": string;
    "Country"?: string;
}

// VerificationResult moved to _shared/addressLists.ts as AddressRow

function validateAddress(row: CSVAddressRow): { isValid: boolean; missingFields: string[] } {
    const missingFields: string[] = [];
    if (!row["Address Line 1"]) missingFields.push("Address Line 1");
    if (!row.City) missingFields.push("City");
    if (!row.State) missingFields.push("State");
    if (!row["Zip Code"]) missingFields.push("Zip Code");
    
    return {
        isValid: missingFields.length === 0,
        missingFields
    };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only POST method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);

    if (!user) {
      return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);
    }

    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse("NO_ORGANIZATION", "User is not associated with any organization", 403);
    }

    // Handle JSON body
    let rawCsv = "";
    let list_name = "Imported List";
    let campaign_id: string | null = null;
    let filename = "imported.csv";
    let column_mapping: Record<string, string> | null = null;

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        return errorResponse("UNSUPPORTED_MEDIA_TYPE", "Please send application/json", 415);
    }

    try {
        const body = await req.json();
        const { campaign_id: cid, list_name: name, csv_data, filename: fn, column_mapping: mapping } = body;
        campaign_id = cid;
        list_name = name || list_name;
        filename = fn || filename;
        column_mapping = mapping || null;
        
        if (!csv_data) return errorResponse("INVALID_INPUT", "csv_data is required", 400);
        if (!campaign_id) return errorResponse("INVALID_INPUT", "campaign_id is required", 400);

        rawCsv = csv_data;
        if (csv_data.startsWith("data:")) {
            try {
                const parts = csv_data.split(",");
                const base64Content = parts.length > 1 ? parts[1] : parts[0];
                rawCsv = atob(base64Content);
            } catch {
                return errorResponse("INVALID_INPUT", "Invalid base64 encoding in csv_data", 400);
            }
        }
    } catch (_e) {
        return errorResponse("INVALID_JSON", "Failed to parse JSON body", 400);
    }

    // Parse CSV rows raw
    const rawRows = parse(rawCsv, { skipFirstRow: false }) as string[][];
    if (rawRows.length < 2) {
      return errorResponse("INVALID_INPUT", "CSV file is empty or missing data rows", 400);
    }

    const headers = rawRows[0].map(h => h.trim());
    const dataRows = rawRows.slice(1);

    // Resolve Mapping
    const expectedFields = [
        "Address Line 1", "Address Line 2", "City", "State", "Zip Code", 
        "Country"
    ];
    const mandatoryFields = ["Address Line 1", "City", "State", "Zip Code"];
    
    const finalMapping: Record<string, number> = {};
    
    for (const field of expectedFields) {
        // 1. Check user provided mapping (key is target field, value is CSV header)
        if (column_mapping && column_mapping[field]) {
            const index = headers.indexOf(column_mapping[field]);
            if (index !== -1) finalMapping[field] = index;
        } 
        // 2. Try exact match in CSV headers
        if (finalMapping[field] === undefined) {
            const index = headers.indexOf(field);
            if (index !== -1) finalMapping[field] = index;
        }
    }

    // Check if mandatory fields are missing
    const missingFromMapping = mandatoryFields.filter(f => finalMapping[f] === undefined);
    if (missingFromMapping.length > 0) {
        return successResponse({
            error: "UNABLE_TO_AUTOMATICALLY_PICK_DATA_COLUMNS",
            message: `Could not find or map mandatory columns: ${missingFromMapping.join(", ")}`,
            located_headers: headers,
            missing_headers: missingFromMapping,
            required_headers: mandatoryFields
        }, 422); // Using 422 Unprocessable Entity for this logical error
    }

    const results: AddressRow[] = [];
    const seenAddresses = new Set<string>();

    // Process rows
    for (const rawRow of dataRows) {
        const row: CSVAddressRow = {
            "Address Line 1": finalMapping["Address Line 1"] !== undefined ? rawRow[finalMapping["Address Line 1"]] : "",
            "Address Line 2": finalMapping["Address Line 2"] !== undefined ? rawRow[finalMapping["Address Line 2"]] : "",
            "City": finalMapping["City"] !== undefined ? rawRow[finalMapping["City"]] : "",
            "State": finalMapping["State"] !== undefined ? rawRow[finalMapping["State"]] : "",
            "Zip Code": finalMapping["Zip Code"] !== undefined ? rawRow[finalMapping["Zip Code"]] : "",
            "Country": (finalMapping["Country"] !== undefined ? rawRow[finalMapping["Country"]] : "") || "US"
        };

        const normalized = `${(row["Address Line 1"] || "").toLowerCase()}|${(row["Address Line 2"] || "").toLowerCase()}|${(row["Zip Code"] || "").toLowerCase()}`;
        
        if (seenAddresses.has(normalized)) {
            results.push({
                id: crypto.randomUUID(),
                address_line1: row["Address Line 1"],
                address_line2: row["Address Line 2"],
                city: row.City,
                state: row.State,
                zip: row["Zip Code"],
                country: row.Country,
                status: "duplicate",
                is_valid: true, // It might be valid but it is a duplicate
                is_duplicate: true,
                is_included: false,
                is_deleted: false,
                error_message: "Duplicate address found in list"
            });
            continue;
        }

        seenAddresses.add(normalized);

        const { isValid, missingFields } = validateAddress(row);
        
        if (isValid) {
            results.push({
                id: crypto.randomUUID(),
                address_line1: row["Address Line 1"],
                address_line2: row["Address Line 2"],
                city: row.City,
                state: row.State,
                zip: row["Zip Code"],
                country: row.Country,
                status: "valid",
                is_valid: true,
                is_duplicate: false,
                is_included: true,
                is_deleted: false
            });
        } else {
            results.push({
                id: crypto.randomUUID(),
                address_line1: row["Address Line 1"],
                address_line2: row["Address Line 2"],
                city: row.City,
                state: row.State,
                zip: row["Zip Code"],
                country: row.Country,
                status: "invalid",
                is_valid: false,
                is_duplicate: false,
                is_included: false,
                is_deleted: false,
                error_message: `Missing required fields: ${missingFields.join(", ")}`
            });
        }
    }

    const valid_addresses = results.filter(r => r.status === "valid").length;
    const invalid_addresses = results.filter(r => r.status === "invalid").length;
    const duplicate_addresses = results.filter(r => r.status === "duplicate").length;

    // Persistence layer: Re-use existing list if it exists for this campaign
    const { data: existingList, error: fetchError } = await supabase
      .from("campaign_csv_address_lists")
      .select("id, operation_history")
      .eq("campaign_id", campaign_id)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (fetchError) {
        console.error("Error fetching existing list:", fetchError);
    }

    let listId: string;
    const timestamp = new Date().toISOString();
    const newOperation = {
        operation: "import",
        timestamp,
        status: "Completed",
        details: {
            total_rows: dataRows.length,
            valid_count: valid_addresses,
            invalid_count: invalid_addresses,
            duplicate_count: duplicate_addresses
        }
    };

    if (existingList) {
        // Update existing record
        listId = existingList.id;
        const updatedHistory = Array.isArray(existingList.operation_history) 
            ? [...existingList.operation_history, newOperation]
            : [newOperation];

        const { error: updateError } = await supabase
          .from("campaign_csv_address_lists")
          .update({
            list_name,
            original_filename: filename,
            addresses: results,
            validated_address_list: [], // Clear old validated addresses
            center: null,               // Clear old center point
            operation_history: updatedHistory,
            metadata: { 
                total_rows: dataRows.length,
                valid_count: valid_addresses,
                invalid_count: invalid_addresses,
                duplicate_count: duplicate_addresses,
                mapping_used: finalMapping,
                re_imported_at: timestamp
            },
            updated_at: timestamp
          })
          .eq("id", listId);

        if (updateError) {
            console.error("Update error:", updateError);
            return errorResponse("DATABASE_ERROR", "Failed to update existing address list", 500);
        }
    } else {
        // Insert new record
        const { data: newList, error: insertError } = await supabase
          .from("campaign_csv_address_lists")
          .insert({
            organization_id: organizationId,
            campaign_id: campaign_id,
            list_name,
            original_filename: filename,
            addresses: results,
            validated_address_list: [], 
            center: null,
            operation_history: [newOperation],
            metadata: { 
                total_rows: dataRows.length,
                valid_count: valid_addresses,
                invalid_count: invalid_addresses,
                duplicate_count: duplicate_addresses,
                mapping_used: finalMapping
            }
          })
          .select("id")
          .single();

        if (insertError) {
            console.error("Persistence error:", insertError);
            return errorResponse("DATABASE_ERROR", "Failed to persist address list", 500);
        }
        listId = newList.id;
    }

    // Update the campaign table with the csv_address_list_id
    const { error: campaignUpdateError } = await supabase
        .from("campaigns")
        .update({ 
            csv_address_list_id: listId,
            updated_at: timestamp 
        })
        .eq("id", campaign_id)
        .eq("organization_id", organizationId);

    if (campaignUpdateError) {
        console.error("Campaign update error:", campaignUpdateError);
        // We don't fail the whole request if this minor step fails, but we should log it
    }

    return successResponse({
        list_id: listId,
        total_addresses: dataRows.length,
        valid_addresses,
        invalid_addresses,
        duplicate_addresses,
        results
    });

  } catch (error) {
    console.error("Unexpected error in importAddressList:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
