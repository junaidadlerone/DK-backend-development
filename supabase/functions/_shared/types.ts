// User roles
export type UserRole = "ADMIN" | "MARKETER" | "TECHNICIAN";

// Profile from database
export interface Profile {
  id: string;
  role: UserRole;
  full_name: string | null;
  onboarding?: boolean;
  created_at: string;
  updated_at: string;
}

// Sign up request
export interface SignUpRequest {
  email: string;
  password: string;
  fullName?: string;
  role?: UserRole;
}

// Login request
export interface LoginRequest {
  email: string;
  password: string;
}

// Login response
export interface LoginResponse {
  status: string;
  message: string;
  token: string;
  refreshToken: string;
  expiresIn: number;
  role: UserRole;
  onboarding: boolean;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    is_verified: boolean;
  };
}

// Sign up response
export interface SignUpResponse {
  status: string;
  message: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    role: UserRole;
  };
}

// Forgot password request
export interface ForgotPasswordRequest {
  email: string;
}

// Reset password request
export interface ResetPasswordRequest {
  access_token: string;
  newPassword: string;
}

// Get user response
export interface GetUserResponse {
  status: string;
  data: {
    id: string;
    email: string;
    role: UserRole;
    full_name: string | null;
    created_at: string;
    auth_type: string;
    is_verified?: boolean;
    onboarding?: boolean;
  };
}

// Generic message response
export interface MessageResponse {
  status: string;
  message: string;
}

// API Error
export interface ApiError {
  error: string;
  message: string;
}

// Refresh token request
export interface RefreshTokenRequest {
  refreshToken: string;
}

// Refresh token response
export interface RefreshTokenResponse {
  status: string;
  message: string;
  token: string;
  refreshToken: string;
  expiresIn: number;
}

// Organization member
export interface OrganizationMember {
  member_uid: string;
  member_role: UserRole;
  full_name: string | null;
  email: string | null;
}

// Organization from database
export interface Organization {
  id: string;
  owner_id: string;
  business_name: string | null;
  registration_number: string | null;
  industry: string | null;
  business_address: string | null;
  business_email: string | null;
  phone_number: string | null;
  website_url: string | null;
  organization_members: OrganizationMember[];
  created_at: string;
  updated_at: string;
}

// Save organization request
// Optional fields are `string | null`: an OMITTED key leaves the stored value untouched, while an
// explicit null (or "") clears it. Before 2026-07-31 every optional was written as `value || null`,
// so omitting a field erased it — see the merge note in saveOrganization/index.ts.
export interface SaveOrganizationRequest {
  business_name: string;
  registration_number?: string | null;
  industry?: string | null;
  business_address: string;
  business_email: string;
  phone_number?: string | null;
  website_url?: string | null;
}

// Get organization response
export interface GetOrganizationResponse {
  status: string;
  data: Organization;
}

// User info for createdBy field in addresses
export interface CreatedByInfo {
  id: string;
  user_role: UserRole;
  full_name: string | null;
  created_at: string;
  updated_at: string;
}
