import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.39.3";

// Define user roles type
export type UserRole = "ADMIN" | "MARKETER" | "TECHNICIAN";

// Profile interface
export interface Profile {
  id: string;
  role: UserRole;
  full_name: string | null;
  created_at: string;
  updated_at: string;
  onboarding?: boolean;
  is_super_admin: boolean;
  multi_org_enabled: boolean;
  active_organization_id: string | null;
}

/**
 * Initialize Supabase client with service role key
 * This client has elevated privileges and bypasses RLS policies
 */
export function createSupabaseClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Initialize Supabase client with anon key (for user-level operations)
 * This client respects RLS policies
 */
export function createSupabaseAnonClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * Get user's role from the profiles table
 * @param userId - The user's UUID
 * @returns The user's role or null if not found
 */
export async function getUserRole(userId: string): Promise<UserRole | null> {
  const supabase = createSupabaseClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return null;
  }

  return data.role as UserRole;
}

/**
 * Check if a user has ADMIN role
 * @param userId - The user's UUID
 * @returns True if user is an admin, false otherwise
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const role = await getUserRole(userId);
  return role === "ADMIN";
}

/**
 * Get user's full profile
 * @param userId - The user's UUID
 * @returns The user's profile or null if not found
 */
export async function getUserProfile(userId: string): Promise<Profile | null> {
  const supabase = createSupabaseClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Profile;
}

/**
 * Validate email format
 * @param email - Email address to validate
 * @returns True if valid, false otherwise
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 * Requirements:
 * - At least 8 characters long
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 * @param password - Password to validate
 * @returns Object with isValid flag and error message if invalid
 */
export function validatePassword(password: string): { isValid: boolean; error?: string } {
  if (!password || password.length < 8) {
    return {
      isValid: false,
      error: "Password must be at least 8 characters long",
    };
  }

  // Check for at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one uppercase letter",
    };
  }

  // Check for at least one lowercase letter
  if (!/[a-z]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one lowercase letter",
    };
  }

  // Check for at least one number
  if (!/[0-9]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one number",
    };
  }

  // Check for at least one special character
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one special character (!@#$%^&* etc.)",
    };
  }

  return { isValid: true };
}

/**
 * Validate user role
 * @param role - Role to validate
 * @returns True if valid role, false otherwise
 */
export function isValidRole(role: string): role is UserRole {
  return ["ADMIN", "MARKETER", "TECHNICIAN"].includes(role);
}
