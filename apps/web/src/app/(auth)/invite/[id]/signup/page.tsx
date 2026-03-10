import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { InviteSignupForm } from "@/components/invite/invite-signup-form";

export default async function InviteSignupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabaseAdmin = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  );

  const { data: invitation } = await supabaseAdmin
    .from("invitations")
    .select("email, first_name, last_name")
    .eq("id", id)
    .single();

  return (
    <InviteSignupForm
      inviteId={id}
      email={invitation?.email ?? ""}
      firstName={invitation?.first_name ?? ""}
      lastName={invitation?.last_name ?? ""}
    />
  );
}
