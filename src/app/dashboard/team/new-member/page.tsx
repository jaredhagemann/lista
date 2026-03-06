import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/get-active-membership";
import { NewMemberForm } from "@/components/team/new-member-form";

export default async function NewMemberPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;

  if (role !== "player" && role !== "manager") {
    redirect("/dashboard/team");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const membership = await getActiveMembership(supabase, user.id);
  if (!membership) redirect("/dashboard");

  const isAdmin =
    membership.role === "coach" || membership.role === "manager";
  if (!isAdmin) redirect("/dashboard/team");

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">
          Invite {role === "player" ? "player" : "manager"}
        </h1>
        <p className="mt-1 text-muted-foreground">
          Send an invitation email to add a new team member.
        </p>
      </div>
      <NewMemberForm teamId={membership.team_id!} role={role as "player" | "manager"} />
    </div>
  );
}
