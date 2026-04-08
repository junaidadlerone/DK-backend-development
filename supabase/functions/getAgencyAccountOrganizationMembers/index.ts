import { corsResponse, errorResponse, successResponse } from "../_shared/response.ts";
import { createSupabaseClient } from "../_shared/client.ts";
import { getUserFromRequest } from "../_shared/history.ts";

/**
 * Get Agency Account Organization Members
 * Returns all members of the organization the authenticated user signed up with (their owned org).
 * Only accessible by the org owner.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  if (req.method !== "GET") {
    return errorResponse("METHOD_NOT_ALLOWED", "Only GET method is allowed", 405);
  }

  try {
    const supabase = createSupabaseClient();
    const user = getUserFromRequest(req);

    if (!user) {
      return errorResponse("UNAUTHORIZED", "Unable to authenticate user", 401);
    }

    // Find the org this user owns (their signup org)
    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("id, business_name, organization_members")
      .eq("owner_id", user.userId)
      .maybeSingle();

    if (orgError) {
      console.error("[getAgencyAccountOrganizationMembers] org fetch error:", orgError);
      return errorResponse("FETCH_FAILED", "Failed to fetch organization", 500);
    }

    if (!org) {
      return errorResponse("NOT_FOUND", "No owned organization found for this user", 404);
    }

    const rawMembers: { member_uid: string; member_role: string }[] = Array.isArray(org.organization_members)
      ? org.organization_members
      : [];

    if (rawMembers.length === 0) {
      return successResponse({ status: "success", organization_id: org.id, members: [] });
    }

    const memberIds = rawMembers.map((m) => m.member_uid);

    const [{ data: profiles }, { data: authUsers }] = await Promise.all([
      supabase.from("profiles").select("id, full_name").in("id", memberIds),
      supabase.auth.admin.listUsers(),
    ]);

    const profileMap = new Map<string, any>();
    for (const p of profiles ?? []) profileMap.set(p.id, p);

    const emailMap = new Map<string, string>();
    for (const u of authUsers?.users ?? []) {
      if (u.email) emailMap.set(u.id, u.email);
    }

    const members = rawMembers.map((m) => ({
      id: m.member_uid,
      role: m.member_role,
      full_name: profileMap.get(m.member_uid)?.full_name ?? null,
      email: emailMap.get(m.member_uid) ?? null,
    }));

    return successResponse({
      status: "success",
      organization_id: org.id,
      organization_name: org.business_name,
      members,
    });

  } catch (error) {
    console.error("[getAgencyAccountOrganizationMembers] Unexpected error:", error);
    return errorResponse("INTERNAL_ERROR", "An unexpected error occurred", 500);
  }
});
