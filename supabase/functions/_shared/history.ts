import { SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";
import { CreatedByInfo } from "./types.ts";

/**
 * Logs an action to the referral history
 *
 * @param supabase - Supabase client
 * @param referralId - ID of the referral
 * @param userId - ID of the user performing the action
 * @param userName - Full name of the user (first name + last name)
 * @param action - Description of the action performed
 */
export async function logReferralHistory(
  supabase: SupabaseClient,
  referralId: string,
  userId: string,
  userName: string,
  action: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from("referral_history")
      .insert({
        referral_id: referralId,
        user_id: userId,
        user_name: userName,
        action: action
      });

    if (error) {
      console.error("Error logging referral history:", error);
      // Don't throw error - logging failure shouldn't break the main operation
    }
  } catch (error) {
    console.error("Unexpected error logging referral history:", error);
    // Don't throw error - logging failure shouldn't break the main operation
  }
}

/**
 * Extracts user information from JWT token
 *
 * @param req - Request object
 * @returns Object with userId, userName, and isServiceRole flag, or null if extraction fails
 */
export function getUserFromRequest(req: Request): { userId: string; userName: string; isServiceRole: boolean } | null {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return null;

    const token = authHeader.replace("Bearer ", "");

    // Decode JWT token (without verification, as Supabase already verified it)
    const payload = JSON.parse(atob(token.split(".")[1]));

    const userId = payload.sub;
    const isServiceRole = payload.role === "service_role";
    const userMetadata = payload.user_metadata || {};
    const fullName = userMetadata.full_name || userMetadata.fullName || (isServiceRole ? "System Service" : "Unknown User");

    return { userId, userName: fullName, isServiceRole };
  } catch (error) {
    console.error("Error extracting user from request:", error);
    return null;
  }
}

/**
 * Gets user profile information from the database
 *
 * @param supabase - Supabase client
 * @param userId - ID of the user
 * @returns CreatedByInfo object or null if user not found
 */
export async function getUserProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<CreatedByInfo | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, role, full_name, created_at, updated_at")
      .eq("id", userId)
      .single();

    if (error || !data) {
      console.error("Error fetching user profile:", error);
      return null;
    }

    return {
      id: data.id,
      user_role: data.role,
      full_name: data.full_name,
      created_at: data.created_at,
      updated_at: data.updated_at
    };
  } catch (error) {
    console.error("Unexpected error fetching user profile:", error);
    return null;
  }
}
