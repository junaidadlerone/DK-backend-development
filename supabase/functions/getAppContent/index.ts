import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient, getUserProfile } from "../_shared/client.ts";
import { getUserOrganizationId } from "../_shared/organization.ts";
import { getUserFromRequest } from "../_shared/history.ts";

/**
 * Get App Content Edge Function
 * Returns role-based menu configuration for the authenticated user
 *
 * Business Rules:
 * - Returns menu items based on user's role within their organization
 * - ADMIN: Full access to all features
 * - MARKETER: Access to campaigns, referrals, analytics, targeting, notifications
 * - TECHNICIAN: Access to referrals and notifications only
 * - All users get notifications access
 */
Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return corsResponse();
  }

  // Only allow GET requests
  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    // Create Supabase client
    const supabase = createSupabaseClient();

    // Get user from request
    const user = getUserFromRequest(req);
    if (!user) {
      return errorResponse(
        "UNAUTHORIZED",
        "Unable to authenticate user",
        401
      );
    }

    // Get user's profile to get their role and branding settings
    const { data: userProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role, branding_settings")
      .eq("id", user.userId)
      .single();

    if (profileError || !userProfile) {
      return errorResponse(
        "PROFILE_NOT_FOUND",
        "User profile not found",
        404
      );
    }

    // Get user's organization
    const organizationId = await getUserOrganizationId(supabase, user.userId);
    if (!organizationId) {
      return errorResponse(
        "NO_ORGANIZATION",
        "User is not associated with any organization",
        403
      );
    }

    // Fetch the org owner's branding so all members share the same theme
    const { data: org } = await supabase
      .from("organizations")
      .select("owner_id")
      .eq("id", organizationId)
      .single();

    let ownerBrandingSettings = userProfile.branding_settings;
    if (org?.owner_id && org.owner_id !== user.userId) {
      const { data: ownerProfile } = await supabase
        .from("profiles")
        .select("branding_settings")
        .eq("id", org.owner_id)
        .single();
      if (ownerProfile?.branding_settings) {
        ownerBrandingSettings = ownerProfile.branding_settings;
      }
    }

    // Get user's system preferences (currency and timezone)
    const { data: preferences } = await supabase
      .from("system_preferences")
      .select(`
        selected_timezone_id,
        selected_currency_id,
        timezone:timezones(id, symbol, name),
        currency:currencies(id, symbol, name, abbreviation)
      `)
      .eq("user_id", user.userId)
      .single();

    // Extract timezone and currency objects
    const timezone = preferences?.timezone || null;
    const currency = preferences?.currency || null;

    // Fetch app content for user's role and organization
    const { data: appContent, error: contentError } = await supabase
      .from("app_content")
      .select("menu_items")
      .eq("organization_id", organizationId)
      .eq("role", userProfile.role)
      .single();

    if (contentError) {
      console.error("Error fetching app content:", contentError);
      
      // If no app content found, create default content for this organization
      if (contentError.code === 'PGRST116') {
        try {
          // Call the function to create default app content
          const { error: createError } = await supabase.rpc(
            'create_default_app_content',
            { org_id: organizationId }
          );

          if (createError) {
            console.error("Error creating default app content:", createError);
            return errorResponse(
              "CONTENT_CREATION_FAILED",
              "Failed to create default app content",
              500
            );
          }

          // Retry fetching after creating default content
          const { data: retryAppContent, error: retryError } = await supabase
            .from("app_content")
            .select("menu_items")
            .eq("organization_id", organizationId)
            .eq("role", userProfile.role)
            .single();

          if (retryError || !retryAppContent) {
            console.error("Error fetching app content after creation:", retryError);
            return errorResponse(
              "CONTENT_FETCH_FAILED",
              "Failed to fetch app content",
              500
            );
          }

          // Check if there are unread notifications for this user
          const { count: unreadCount } = await supabase
            .from("notifications")
            .select("*", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .contains("target_roles", [userProfile.role])
            .eq("is_read", false);

          const hasUnreadNotifications = (unreadCount || 0) > 0;

          // Add isUnread flag to notifications menu item
          let menuItems = retryAppContent.menu_items;
          if (Array.isArray(menuItems)) {
            menuItems = menuItems.map((item: any) => {
              if (item.name === "notifications") {
                return {
                  ...item,
                  isUnread: hasUnreadNotifications
                };
              }
              return item;
            });
          }

          // Return the newly created content with theme, currency, and timezone
          return successResponse({
            data: {
              menu_items: menuItems,
              theme: ownerBrandingSettings?.theme || {
                colors: {
                  primary: "#E36A00",
                  secondary: "#1D1D20",
                  accent: "#47BAD7"
                },
                fonts: {
                  primary: { name: "Poppins" },
                  body: { name: "Poppins" }
                }
              },
              currency: currency,
              timezone: timezone
            }
          });

        } catch (createError) {
          console.error("Error in default content creation process:", createError);
          return errorResponse(
            "CONTENT_CREATION_FAILED",
            "Failed to initialize app content",
            500
          );
        }
      }

      return errorResponse(
        "CONTENT_FETCH_FAILED",
        "Failed to fetch app content",
        500
      );
    }

    if (!appContent) {
      return errorResponse(
        "CONTENT_NOT_FOUND",
        "App content not found for your role",
        404
      );
    }

    // Check if there are unread notifications for this user
    const { count: unreadCount } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .contains("target_roles", [userProfile.role])
      .eq("is_read", false);

    const hasUnreadNotifications = (unreadCount || 0) > 0;

    // Add isUnread flag to notifications menu item
    let menuItems = appContent.menu_items;
    if (Array.isArray(menuItems)) {
      menuItems = menuItems.map((item: any) => {
        if (item.name === "notifications") {
          return {
            ...item,
            isUnread: hasUnreadNotifications
          };
        }
        return item;
      });
    }

    // Return the menu items, theme, currency, and timezone in the expected format
    return successResponse({
      data: {
        menu_items: menuItems,
        theme: ownerBrandingSettings?.theme || {
          colors: {
            primary: "#E36A00",
            secondary: "#1D1D20",
            accent: "#47BAD7"
          },
          fonts: {
            primary: { name: "Poppins" },
            body: { name: "Poppins" }
          }
        },
        currency: currency,
        timezone: timezone
      }
    });

  } catch (error) {
    console.error("Unexpected error in getAppContent:", error);

    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred. Please try again later.",
      500
    );
  }
});