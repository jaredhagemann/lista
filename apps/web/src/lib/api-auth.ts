import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { User } from "@supabase/supabase-js";

export function adminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Resolves the calling user from the request.
 *
 * Resolution order:
 * 1. Cookie-based auth via the server Supabase client (web callers)
 * 2. Authorization: Bearer <token> header via the admin client (mobile callers)
 *
 * Returns the resolved User, or null if neither method succeeds.
 */
export async function resolveRequestUser(request: Request): Promise<User | null> {
  // 1. Cookie-based auth (web callers)
  const serverClient = await createServerClient();
  const { data: { user: cookieUser } } = await serverClient.auth.getUser();
  if (cookieUser) return cookieUser;

  // 2. Bearer token (mobile callers)
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const { data: { user } } = await adminClient().auth.getUser(token);
  return user ?? null;
}
