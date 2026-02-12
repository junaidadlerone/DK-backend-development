
import { SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

export interface UserPreferences {
  timezone: string;       // e.g., "America/New_York"
  timezone_id: string | null;
  currency: string;       // e.g., "USD"
  currency_id: string | null;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  timezone: "UTC",
  timezone_id: null,
  currency: "USD",
  currency_id: null
};

/**
 * Retrieves user preferences (timezone and currency) from system_preferences table.
 * Returns defaults if no preferences found or error occurs.
 * 
 * @param supabase - Supabase client instance
 * @param userId - ID of the user to fetch preferences for
 * @returns UserPreferences object
 */
export async function getUserPreferences(
  supabase: SupabaseClient,
  userId: string
): Promise<UserPreferences> {
  if (!userId) {
    return DEFAULT_PREFERENCES;
  }

  try {
    const { data: preferences, error } = await supabase
      .from("system_preferences")
      .select(`
        selected_timezone_id,
        selected_currency_id,
        timezones(id, symbol, name),
        currencies(id, symbol, name, abbreviation)
      `)
      .eq("user_id", userId)
      .single();

    if (error || !preferences) {
      // It's common to not have preferences set yet, just return defaults silent/warn
      return DEFAULT_PREFERENCES;
    }

    // Safely extract nested data
    const timezone = Array.isArray(preferences.timezones) ? preferences.timezones[0] : preferences.timezones;
    const currency = Array.isArray(preferences.currencies) ? preferences.currencies[0] : preferences.currencies;

    return {
      timezone: timezone?.symbol || DEFAULT_PREFERENCES.timezone,
      timezone_id: preferences.selected_timezone_id,
      currency: currency?.abbreviation || DEFAULT_PREFERENCES.currency,
      currency_id: preferences.selected_currency_id
    };

  } catch (error) {
    console.warn("Error fetching user preferences, using defaults:", error);
    return DEFAULT_PREFERENCES;
  }
}

// Alias for backward compatibility with recent changes
export const getPreferences = getUserPreferences;
