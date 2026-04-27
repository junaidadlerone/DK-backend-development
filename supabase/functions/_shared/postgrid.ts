/**
 * PostGrid Integration Utilities
 * 
 * Shared functions for interacting with PostGrid Print & Mail API.
 */

const POSTGRID_API_KEY = Deno.env.get("POSTGRID_POSTCARD_API_KEY");
const POSTGRID_BASE_URL = "https://api.postgrid.com/print-mail/v1";

/**
 * Creates a PostGrid Tracker for PURL and QR code generation.
 * 
 * @param redirectURLTemplate The destination URL with optional merge variables
 * @param urlExpireAfterDays Number of days until the PURL expires
 * @returns The created tracker object
 */
export async function createPostGridTracker(
  redirectURLTemplate: string = "https://postgrid.com?name={{to.firstName}}",
  urlExpireAfterDays: number = 30
) {
  if (!POSTGRID_API_KEY) {
    throw new Error("POSTGRID_POSTCARD_API_KEY environment variable is not set");
  }

  const requestBody = { 
    redirectURLTemplate,
    urlExpireAfterDays
  };
  
  const requestOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": POSTGRID_API_KEY,
    },
    body: JSON.stringify(requestBody),
  };
  
  const response = await fetch(`${POSTGRID_BASE_URL}/trackers`, requestOptions);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PostGrid API Error (${response.status}): ${errorText}`);
  }
  
  return await response.json();
}

/**
 * Retrieves a PostGrid template by its ID.
 * Returns { exists: true, data } on success, or { exists: false, error } when the
 * template cannot be found (404) or the API returns any other error status.
 *
 * @param templateId The PostGrid template ID (e.g. "template_abc123")
 */
export async function getPostGridTemplate(
  templateId: string
): Promise<{ exists: boolean; data?: unknown; error?: string }> {
  if (!POSTGRID_API_KEY) {
    throw new Error("POSTGRID_POSTCARD_API_KEY environment variable is not set");
  }

  const response = await fetch(`${POSTGRID_BASE_URL}/templates/${templateId}`, {
    method: "GET",
    headers: {
      "x-api-key": POSTGRID_API_KEY,
    },
  });

  if (response.status === 404) {
    return { exists: false, error: "Template not found on PostGrid" };
  }

  if (!response.ok) {
    const errorText = await response.text();
    return {
      exists: false,
      error: `PostGrid API error (${response.status}): ${errorText}`,
    };
  }

  const data = await response.json();
  return { exists: true, data };
}

/**
 * Retrieves statistics for a PostGrid Tracker.
 *
 * @param id The tracker ID
 * @returns The tracker object containing totalCount and uniqueCount
 */
export async function getPostGridTrackerStats(id: string) {
  if (!POSTGRID_API_KEY) {
    throw new Error("POSTGRID_POSTCARD_API_KEY environment variable is not set");
  }

  const response = await fetch(`${POSTGRID_BASE_URL}/trackers/${id}`, {
    method: "GET",
    headers: {
      "x-api-key": POSTGRID_API_KEY,
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PostGrid API Error (${response.status}): ${errorText}`);
  }

  return await response.json();
}
