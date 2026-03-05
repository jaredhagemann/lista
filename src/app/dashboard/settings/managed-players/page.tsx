import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ManagedPlayersList } from "@/components/settings/managed-players-list";
import { CreateManagedPlayerForm } from "@/components/settings/create-managed-player-form";
import type { Database } from "@/types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

export default async function ManagedPlayersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: rawLinks } = await supabase
    .from("profile_managers")
    .select("managed_id, relationship, profiles!managed_id(*)")
    .eq("manager_id", user.id);

  const managedProfiles = (rawLinks ?? []).map((link) => ({
    profile: link.profiles as unknown as Profile,
    relationship: link.relationship,
  }));

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Managed Players</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage player profiles on behalf of others — typically your children.
        </p>
      </div>

      <CreateManagedPlayerForm managerId={user.id} />

      {managedProfiles.length > 0 && (
        <ManagedPlayersList managedProfiles={managedProfiles} />
      )}
    </div>
  );
}
