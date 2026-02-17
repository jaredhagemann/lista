import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AcceptInviteClient } from "./accept-invite-client";
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
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/signup?invite=${id}`);
  }

  // Fetch invitation details
  const { data: rawInvitation, error } = await supabase
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
    redirect("/dashboard");
  }

  return (
    <AcceptInviteClient
      invitationId={invitation.id}
      teamName={(invitation.teams as { name: string })?.name ?? "Unknown Team"}
      role={invitation.role}
      teamId={invitation.team_id}
    />
  );
}
