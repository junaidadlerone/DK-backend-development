/**
 * Shared Notification Helpers
 * Helper functions for creating notifications across different APIs
 */

interface CreateNotificationParams {
  supabase: any;
  organizationId: string;
  notificationType: string;
  title: string;
  description: string;
  targetRoles: string[];
  metadata?: Record<string, any>;
}

/**
 * Create a notification for specific roles in an organization
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const {
    supabase,
    organizationId,
    notificationType,
    title,
    description,
    targetRoles,
    metadata = {}
  } = params;

  try {
    const { error } = await supabase
      .from("notifications")
      .insert({
        organization_id: organizationId,
        notification_type: notificationType,
        title,
        description,
        target_roles: targetRoles,
        metadata,
        is_read: false
      });

    if (error) {
      console.error("Error creating notification:", error);
      // Don't throw - notifications are non-critical
    }
  } catch (err) {
    console.error("Exception creating notification:", err);
    // Don't throw - notifications are non-critical
  }
}

/**
 * Role definitions for easy reference
 */
export const ROLES = {
  TECHNICIAN: "TECHNICIAN",
  MARKETER: "MARKETER",
  ADMIN: "ADMIN",
  ALL: ["TECHNICIAN", "MARKETER", "ADMIN"],
  MARKETER_AND_ADMIN: ["MARKETER", "ADMIN"],
  ADMIN_ONLY: ["ADMIN"]
} as const;
