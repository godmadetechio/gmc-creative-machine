import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS. Server-side only, never in the dashboard.
export function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — copy .env.example to .env.local at the repo root",
    );
  }

  return createClient(url, key, { auth: { persistSession: false } });
}
