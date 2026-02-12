import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Logs an action to campaign history
 *
 * @param supabase - Supabase client
 * @param campaignId - Campaign ID
 * @param userId - User ID performing the action
 * @param userName - User's full name
 * @param action - Description of the action
 */
export async function logCampaignHistory(
  supabase: SupabaseClient,
  campaignId: string,
  userId: string,
  userName: string,
  action: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from("campaign_history")
      .insert({
        campaign_id: campaignId,
        user_id: userId,
        user_name: userName,
        action: action
      });

    if (error) {
      console.error("Error logging campaign history:", error);
      // Don't throw error - logging failure shouldn't break the main operation
    }
  } catch (error) {
    console.error("Unexpected error logging campaign history:", error);
  }
}
