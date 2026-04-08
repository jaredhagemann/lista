"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createRawClient } from "@supabase/supabase-js";

export async function changePassword(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData
): Promise<{ error?: string; success?: boolean }> {
  const currentPassword = formData.get("currentPassword") as string;
  const newPassword = formData.get("newPassword") as string;

  if (!currentPassword || !newPassword) {
    return { error: "update_failed" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { error: "update_failed" };
  }

  // Verify current password using a fresh anon client (no cookie side effects)
  const verifyClient = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error: signInError } = await verifyClient.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (signInError) {
    return { error: "current_password_incorrect" };
  }

  // Update password via service role client — no new session is created
  const adminClient = createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error: updateError } = await adminClient.auth.admin.updateUserById(
    user.id,
    { password: newPassword }
  );

  if (updateError) {
    return { error: "update_failed" };
  }

  return { success: true };
}
