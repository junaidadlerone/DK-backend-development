import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * Logs an action to template history
 *
 * @param supabase - Supabase client
 * @param templateId - Template ID (database UUID)
 * @param userId - User ID performing the action
 * @param userName - User's full name
 * @param action - Description of the action
 */
export async function logTemplateHistory(
  supabase: SupabaseClient,
  templateId: string,
  userId: string,
  userName: string,
  action: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from("template_history")
      .insert({
        template_id: templateId,
        user_id: userId,
        user_name: userName,
        action: action
      });

    if (error) {
      console.error("Error logging template history:", error);
      // Don't throw error - logging failure shouldn't break the main operation
    }
  } catch (error) {
    console.error("Unexpected error logging template history:", error);
  }
}
