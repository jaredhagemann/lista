"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Pencil } from "lucide-react";
import { toast } from "sonner";
import { ImageUpload } from "@/components/ui/image-upload";
import { ManagersCard } from "@/components/team/managers-card";
import { removeTeamMember } from "@/app/actions/team";
import type { Database } from "@/types/database";

type TeamMemberRow = Database["public"]["Tables"]["team_members"]["Row"];
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileManagerRow =
  Database["public"]["Tables"]["profile_managers"]["Row"] & {
    profiles: ProfileRow;
  };
type InvitationRow = Database["public"]["Tables"]["invitations"]["Row"];

export type TeamMemberWithProfile = TeamMemberRow & {
  profiles: ProfileRow;
};

interface RosterProfileProps {
  member: TeamMemberWithProfile;
  managers: ProfileManagerRow[];
  pendingInvites: InvitationRow[];
  canEdit: boolean;
  isAdmin: boolean;
  isOwnProfile: boolean;
  teamId: string;
}

export function RosterProfile({
  member,
  managers,
  pendingInvites,
  canEdit,
  isAdmin,
  isOwnProfile,
  teamId,
}: RosterProfileProps) {
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const profile = member.profiles;
  const fullName = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(" ");
  const initials = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  const router = useRouter();

  async function handleRemove() {
    setRemoving(true);
    const result = await removeTeamMember(member.id, teamId);
    if (result.error) {
      toast.error(result.error);
      setRemoving(false);
    } else {
      toast.success("Member removed from team");
      router.push("/dashboard/team");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/dashboard/team")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <Avatar className="h-10 w-10">
            {profile.avatar_url && (
              <AvatarImage src={profile.avatar_url} alt={fullName} />
            )}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold">{fullName}</h1>
            <Badge variant="secondary" className="capitalize">
              {member.role}
            </Badge>
          </div>
        </div>
        {canEdit && !editing && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        )}
        {editing && (
          <Button variant="outline" onClick={() => setEditing(false)}>
            Done
          </Button>
        )}
      </div>

      {editing ? (
        <EditMode
          member={member}
          managers={managers}
          pendingInvites={pendingInvites}
          isAdmin={isAdmin}
          teamId={teamId}
        />
      ) : (
        <ReadOnlyMode
          member={member}
          managers={managers}
          pendingInvites={pendingInvites}
          canAdd={canEdit}
          teamId={teamId}
        />
      )}

      {/* Remove from team — always visible to admins viewing another member's profile */}
      {isAdmin && !isOwnProfile && (
        <>
          <div className="border-t pt-2">
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => setConfirmRemove(true)}
            >
              Remove from team
            </Button>
          </div>

          <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Remove Member</DialogTitle>
                <DialogDescription>
                  Are you sure you want to remove{" "}
                  <strong>
                    {profile.first_name} {profile.last_name}
                  </strong>{" "}
                  from the team? Their profile and history will be preserved,
                  but they will lose all access to team pages.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setConfirmRemove(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRemove}
                  disabled={removing}
                >
                  {removing ? "Removing…" : "Remove"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function ReadOnlyMode({
  member,
  managers,
  pendingInvites,
  canAdd,
  teamId,
}: {
  member: TeamMemberWithProfile;
  managers: ProfileManagerRow[];
  pendingInvites: InvitationRow[];
  canAdd: boolean;
  teamId: string;
}) {
  const profile = member.profiles;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          {profile.avatar_url && (
            <div className="mb-4 flex justify-center">
              <img
                src={profile.avatar_url}
                alt={`${profile.first_name} ${profile.last_name}`}
                className="h-20 w-20 rounded-full object-cover"
              />
            </div>
          )}
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">First name</dt>
              <dd>{profile.first_name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Last name</dt>
              <dd>{profile.last_name}</dd>
            </div>
            {profile.birthday && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Birthday</dt>
                <dd>{profile.birthday}</dd>
              </div>
            )}
            {profile.gender && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Gender</dt>
                <dd className="capitalize">{profile.gender}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="capitalize">{member.role}</dd>
            </div>
            {member.role === "player" && member.jersey_number != null && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Jersey number</dt>
                <dd>#{member.jersey_number}</dd>
              </div>
            )}
            {member.role === "player" && member.position && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Position</dt>
                <dd>{member.position}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <ManagersCard
        profileId={member.profile_id!}
        teamId={teamId}
        managers={managers}
        pendingInvites={pendingInvites}
        canEdit={false}
        canAdd={canAdd}
      />
    </>
  );
}

function EditMode({
  member,
  managers,
  pendingInvites,
  isAdmin,
  teamId,
}: {
  member: TeamMemberWithProfile;
  managers: ProfileManagerRow[];
  pendingInvites: InvitationRow[];
  isAdmin: boolean;
  teamId: string;
}) {
  const profile = member.profiles;
  const [firstName, setFirstName] = useState(profile.first_name ?? "");
  const [lastName, setLastName] = useState(profile.last_name ?? "");
  const [birthday, setBirthday] = useState(profile.birthday ?? "");
  const [gender, setGender] = useState(profile.gender ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  const [role, setRole] = useState(member.role);
  const [jerseyNumber, setJerseyNumber] = useState(
    member.jersey_number?.toString() ?? ""
  );
  const [position, setPosition] = useState(member.position ?? "");
  const [savingRole, setSavingRole] = useState(false);
  const [savingJersey, setSavingJersey] = useState(false);
  const [savingPosition, setSavingPosition] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);

    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: firstName,
        last_name: lastName,
        birthday: birthday || null,
        gender: gender || null,
      })
      .eq("id", profile.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Profile updated");
      router.refresh();
    }
    setSavingProfile(false);
  }

  async function handleSaveRole() {
    setSavingRole(true);
    const { error } = await supabase
      .from("team_members")
      .update({ role })
      .eq("id", member.id)
      .eq("team_id", teamId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Role updated");
      router.refresh();
    }
    setSavingRole(false);
  }

  async function handleSaveJersey() {
    setSavingJersey(true);
    const value = jerseyNumber.trim() === "" ? null : Number(jerseyNumber);
    const { error } = await supabase
      .from("team_members")
      .update({ jersey_number: value })
      .eq("id", member.id)
      .eq("team_id", teamId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Jersey number updated");
      router.refresh();
    }
    setSavingJersey(false);
  }

  async function handleSavePosition() {
    setSavingPosition(true);
    const { error } = await supabase
      .from("team_members")
      .update({ position: position.trim() || null })
      .eq("id", member.id)
      .eq("team_id", teamId);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Position updated");
      router.refresh();
    }
    setSavingPosition(false);
  }

  return (
    <>
      {/* Profile edit form */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <form onSubmit={handleSaveProfile}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Profile photo</Label>
              <ImageUpload
                bucket="avatars"
                folder={profile.id}
                currentUrl={profile.avatar_url}
                onUpload={async (url) => {
                  const { error } = await supabase
                    .from("profiles")
                    .update({ avatar_url: url })
                    .eq("id", profile.id);
                  if (error) {
                    toast.error(error.message);
                  } else {
                    router.refresh();
                  }
                }}
                shape="circle"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="birthday">Birthday</Label>
              <Input
                id="birthday"
                type="date"
                value={birthday}
                onChange={(e) => setBirthday(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gender">Gender</Label>
              <Input
                id="gender"
                placeholder="e.g. Male, Female, Non-binary"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={savingProfile}>
              {savingProfile ? "Saving..." : "Save changes"}
            </Button>
          </CardContent>
        </form>
      </Card>

      {/* Managers card */}
      <ManagersCard
        profileId={member.profile_id!}
        teamId={teamId}
        managers={managers}
        pendingInvites={pendingInvites}
        canEdit={true}
      />

      {/* Admin actions */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Admin Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Edit role */}
            <div className="space-y-2">
              <Label>Role</Label>
              <div className="flex gap-2">
                <Select
                  value={role}
                  onValueChange={(v) =>
                    setRole(v as "coach" | "manager" | "player")
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="coach">Coach</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="player">Player</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={handleSaveRole}
                  disabled={savingRole || role === member.role}
                >
                  {savingRole ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>

            {/* Edit jersey number */}
            <div className="space-y-2">
              <Label>Jersey number</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={jerseyNumber}
                  onChange={(e) => setJerseyNumber(e.target.value)}
                  placeholder="—"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleSaveJersey}
                  disabled={savingJersey}
                >
                  {savingJersey ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>

            {/* Edit position */}
            <div className="space-y-2">
              <Label>Position</Label>
              <div className="flex gap-2">
                <Input
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  placeholder="e.g. Defender"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleSavePosition}
                  disabled={savingPosition}
                >
                  {savingPosition ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>

          </CardContent>
        </Card>
      )}
    </>
  );
}
