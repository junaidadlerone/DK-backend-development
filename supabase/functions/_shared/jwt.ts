import { create, verify, getNumericDate } from "https://deno.land/x/djwt@v3.0.1/mod.ts";
import type { JWTPayload } from "./types.ts";

const JWT_SECRET = Deno.env.get("JWT_SECRET") || "your-secret-key-change-this";
const JWT_ACCESS_TOKEN_EXPIRES_IN = 15 * 60; // 15 minutes in seconds
const JWT_REFRESH_TOKEN_EXPIRES_IN = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Generate JWT access token
 * @param payload - User data to encode in the token
 * @returns JWT access token
 */
export async function generateAccessToken(payload: JWTPayload): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );

  return await create(
    { alg: "HS256", typ: "JWT" },
    {
      ...payload,
      exp: getNumericDate(JWT_ACCESS_TOKEN_EXPIRES_IN),
      iat: getNumericDate(0),
    },
    key
  );
}

/**
 * Verify and decode JWT access token
 * @param token - JWT token to verify
 * @returns Decoded payload or null if invalid
 */
export async function verifyAccessToken(token: string): Promise<JWTPayload | null> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );

    const payload = await verify(token, key);
    return payload as JWTPayload;
  } catch (error) {
    console.error("Error verifying access token:", error);
    return null;
  }
}

/**
 * Get refresh token expiry date
 * @returns Date object for token expiry
 */
export function getRefreshTokenExpiry(): Date {
  const expiry = new Date();
  expiry.setSeconds(expiry.getSeconds() + JWT_REFRESH_TOKEN_EXPIRES_IN);
  return expiry;
}

/**
 * Get password reset token expiry date (1 hour)
 * @returns Date object for token expiry
 */
export function getPasswordResetTokenExpiry(): Date {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 1);
  return expiry;
}
