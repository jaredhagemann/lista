import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import { WrongEmailClient } from "@/components/invite/wrong-email-client";
import { DirectAcceptClient } from "@/components/invite/direct-accept-client";
import { IdentityConfirmation } from "@/components/invite/identity-confirmation";
import { ManagerInviteClient } from "@/components/invite/manager-invite-client";
import type { Database } from "@/types/database";

type Invitation = Database["public"]["Tables"]["invitations"]["Row"] & {
  teams: { name: string };
};

export default async function InvitePage({
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

  const { data: rawInvitation, error } = await supabaseAdmin
    .from("invitations")
    .select("*, teams(name)")
    .eq("id", id)
    .single();

  const invitation = rawInvitation as Invitation | null;

  if (error || !invitation) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Invalid invitation</h1>
          <p className="mt-2 text-muted-foreground">
            This invite link is invalid or has expired.
          </p>
        </div>
      </div>
    );
  }

  if (invitation.accepted_at) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Invitation already accepted</h1>
          <p className="mt-2 text-muted-foreground">
            This invitation has already been accepted. Contact your coach if
            you&apos;re unable to log in.
          </p>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/invite/${id}/signup`);
  }

  // Signed in as wrong email — sign out and redirect to invite-specific login
  if (user.email !== invitation.email) {
    return <WrongEmailClient inviteId={id} />;
  }

  const teamName = (invitation.teams as { name: string })?.name ?? "Unknown Team";

  // Invite for managing an existing player profile (sent from ManagersCard)
  if (invitation.managed_profile_id) {
    const { data: playerProfile } = await supabaseAdmin
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", invitation.managed_profile_id)
      .single();

    const playerName = [playerProfile?.first_name, playerProfile?.last_name]
      .filter(Boolean)
      .join(" ");

    return (
      <ManagerInviteClient
        invitationId={invitation.id}
        teamName={teamName}
        playerName={playerName}
        relationship={invitation.relationship}
      />
    );
  }

  // Manager or coach team invite: skip identity step, direct accept
  if (invitation.role === "manager" || invitation.role === "coach") {
    return (
      <DirectAcceptClient
        invitationId={invitation.id}
        teamName={teamName}
        role={invitation.role}
      />
    );
  }

  // Player invite: show identity confirmation
  const { data: userProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return (
    <IdentityConfirmation
      invitation={invitation}
      userProfile={userProfile!}
    />
  );
}
