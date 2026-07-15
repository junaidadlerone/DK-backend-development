import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./env.mjs";

// Service-role client — used ONLY to verify the end-user JWT (auth.getUser).
// User data is never read with this client; it goes through callApi with the
// user's own JWT so the edge functions enforce org/role scoping.
export const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
