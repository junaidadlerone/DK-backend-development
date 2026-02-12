import { DateTime } from "npm:luxon@3.4.4";

export interface TimezoneEnrichment {
  utc: string;
  local: string;
  timezone: string;
  offset: string;
}

/**
 * Enriches a UTC timestamp with local time, timezone, and offset information.
 * Uses 'UTC' as the default timezone if none is provided.
 * 
 * @param timestamp - ISO 8601 UTC timestamp string
 * @param userTimezone - (Optional) IANA timezone string (e.g., "America/Los_Angeles")
 * @returns TimezoneEnrichment object
 */
export function enrichTimestamp(
  timestamp: string,
  userTimezone?: string
): TimezoneEnrichment {
  // Validate input
  if (!timestamp) {
    return {
      utc: "",
      local: "",
      timezone: userTimezone || "UTC",
      offset: "+00:00"
    };
  }

  try {
    const dt = DateTime.fromISO(timestamp, { zone: "utc" });
    
    // Default to UTC if no timezone provided
    const targetZone = userTimezone && userTimezone.trim() !== "" ? userTimezone : "UTC";

    const localDt = dt.setZone(targetZone);

    if (!dt.isValid || !localDt.isValid) {
      console.warn(`Invalid timestamp or timezone: ${timestamp}, ${targetZone}`);
       return {
        utc: timestamp,
        local: timestamp,
        timezone: targetZone,
        offset: "+00:00"
      };
    }

    return {
      utc: dt.toISO() || timestamp,
      local: localDt.toISO() || timestamp,
      timezone: targetZone,
      offset: localDt.toFormat("ZZ")
    };
  } catch (error) {
    console.error("Error enriching timestamp:", error);
    return {
      utc: timestamp,
      local: timestamp,
      timezone: userTimezone || "UTC",
      offset: "+00:00"
    };
  }
}
