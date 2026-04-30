import { headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { InviteLoginForm } from "@/components/invite/invite-login-form";
import { getTenantFromHeaders } from "@/lib/supabase/tenant";

export default async function InviteLoginPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = getTenantFromHeaders(await headers());

  const supabaseAdmin = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => [], setAll: () => {} } }
  );

  const { data: invitation } = await supabaseAdmin
    .from("invitations")
    .select("email")
    .eq("id", id)
    .single();

  return (
    <InviteLoginForm
      inviteId={id}
      email={invitation?.email ?? ""}
      brandName={tenant?.orgNamePublic ?? undefined}
      logoUrl={tenant?.logoUrl ?? undefined}
    />
  );
}
