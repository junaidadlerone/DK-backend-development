// Edge-function call helper — ported from namiMcp/chatKabuki.
// Calls a DK+ Supabase Edge Function with the END USER's JWT so the function
// enforces org/role scoping (same path the SPA uses). Returns parsed JSON or
// null on any non-2xx / error (tools translate null into a graceful message).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./env.mjs";

export async function callApi(endpoint, method, queryParams, accessToken, bodyData) {
  const url = new URL(`${SUPABASE_URL}/functions/v1/${endpoint}`);
  if (queryParams) {
    for (const [key, val] of Object.entries(queryParams)) {
      if (val != null) url.searchParams.set(key, String(val));
    }
  }
  const options = {
    method: method ?? "GET",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "apikey": SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20000),
  };
  if (bodyData) options.body = JSON.stringify(bodyData);
  try {
    const res = await fetch(url.toString(), options);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`callApi ${endpoint} → ${res.status}:`, txt.slice(0, 200));
      // Surface auth/permission failures distinctly so tools can say "needs an
      // admin role" instead of a generic error.
      return { __error: true, status: res.status, body: txt.slice(0, 300) };
    }
    return res.json();
  } catch (err) {
    console.error(`callApi ${endpoint} threw:`, err.message);
    return { __error: true, status: 0, body: err.message };
  }
}
