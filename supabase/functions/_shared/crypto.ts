/**
 * Hash a password using PBKDF2 (Web Crypto API - compatible with Supabase Edge Functions)
 * @param password - Plain text password
 * @returns Hashed password in format: salt:hash
 */
export async function hashPassword(password: string): Promise<string> {
  // Generate a random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Hash the password using PBKDF2
  const passwordBuffer = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    key,
    256
  );

  // Convert to hex strings
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Return in format: salt:hash
  return `${saltHex}:${hashHex}`;
}

/**
 * Verify a password against a hash
 * @param password - Plain text password
 * @param hash - Hashed password in format: salt:hash
 * @returns True if password matches, false otherwise
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  try {
    // Split the stored hash into salt and hash
    const [saltHex, storedHashHex] = hash.split(":");
    if (!saltHex || !storedHashHex) {
      console.error("Invalid hash format");
      return false;
    }

    // Convert salt from hex to Uint8Array
    const salt = new Uint8Array(
      saltHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    // Hash the provided password with the stored salt
    const passwordBuffer = new TextEncoder().encode(password);
    const key = await crypto.subtle.importKey(
      "raw",
      passwordBuffer,
      { name: "PBKDF2" },
      false,
      ["deriveBits"]
    );

    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      key,
      256
    );

    // Convert computed hash to hex
    const computedHashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Constant-time comparison to prevent timing attacks
    return timingSafeEqual(computedHashHex, storedHashHex);
  } catch (error) {
    console.error("Error verifying password:", error);
    return false;
  }
}

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Generate a secure random token
 * @param length - Length of the token in bytes (default: 32)
 * @returns Random token as hex string
 */
export function generateSecureToken(length: number = 32): string {
  const buffer = new Uint8Array(length);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
