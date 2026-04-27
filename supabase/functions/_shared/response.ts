import type { ApiError } from "./types.ts";

/**
 * Create a JSON success response
 */
export function successResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-google-api-key, x-postgrid-api-key, accept",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    },
  });
}

/**
 * Create a JSON error response
 */
export function errorResponse(
  error: string,
  message: string,
  status: number = 400
): Response {
  const errorData: ApiError = { error, message };
  return new Response(JSON.stringify(errorData), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-google-api-key, x-postgrid-api-key, accept",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    },
  });
}

/**
 * Handle CORS preflight requests
 */
export function corsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-google-api-key, x-postgrid-api-key, accept",
      "Access-Control-Max-Age": "86400",
    },
  });
}
