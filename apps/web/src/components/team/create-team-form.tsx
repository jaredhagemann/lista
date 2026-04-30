"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearActiveProfile } from "@/app/actions/team";
import { executeCreateTeam } from "@/lib/create-team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

type ClubOrg = { id: string; name: string; orgNamePublic: string | null };

const NEW_ORG_VALUE = "__new__";

export function CreateTeamForm({
  onSuccess,
  ownedClubOrgs = [],
}: {
  onSuccess?: () => void;
  ownedClubOrgs?: ClubOrg[];
} = {}) {
  const [teamName, setTeamName] = useState("");
  const [season, setSeason] = useState("");
  const [orgName, setOrgName] = useState("");
  const [selectedOrgId, setSelectedOrgId] = useState(NEW_ORG_VALUE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const hasClubOrgs = ownedClubOrgs.length > 0;
  const addingToExistingOrg = hasClubOrgs && selectedOrgId !== NEW_ORG_VALUE;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (addingToExistingOrg) {
      // Add team to an existing club org via the club API
      try {
        const res = await fetch("/api/club/teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId: selectedOrgId, teamName: teamName.trim(), season: season.trim() }),
        });
        if (!res.ok) {
          const { error: msg } = await res.json();
          setError(msg ?? "Failed to create team");
          return;
        }
        toast.success("Team created");
        onSuccess?.();
        router.push("/dashboard");
        router.refresh();
      } finally {
        setLoading(false);
      }
      return;
    }

    // Create a new standalone team (new org)
    const err = await executeCreateTeam({
      teamName,
      season,
      orgName,
      clearActiveProfileFn: clearActiveProfile,
      onSuccess,
      routerPush: router.push,
      routerRefresh: router.refresh,
    });

    if (err) {
      setError(err);
      setLoading(false);
    }
  }

  const formContent = (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 p-1">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Organization selection — only shown for club owners with existing orgs */}
        {hasClubOrgs ? (
          <div className="space-y-2">
            <Label htmlFor="orgSelect">Organization</Label>
            <select
              id="orgSelect"
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {ownedClubOrgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.orgNamePublic ?? org.name}
                </option>
              ))}
              <option value={NEW_ORG_VALUE}>New organization</option>
            </select>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="orgName">Club / organization name</Label>
            <Input
              id="orgName"
              placeholder="e.g. Westside FC"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
        )}

        {/* When "New organization" is chosen from the picker, show the name field */}
        {hasClubOrgs && !addingToExistingOrg && (
          <div className="space-y-2">
            <Label htmlFor="orgName">Organization name</Label>
            <Input
              id="orgName"
              placeholder="e.g. Westside FC"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="teamName">Team name</Label>
          <Input
            id="teamName"
            placeholder="e.g. U12 Boys Blue"
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="season">Season (optional)</Label>
          <Input
            id="season"
            placeholder="e.g. Spring 2026"
            value={season}
            onChange={(e) => setSeason(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4">
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Creating..." : "Create team"}
        </Button>
      </div>
    </form>
  );

  // When rendered inside a dialog (onSuccess provided), skip the Card wrapper
  if (onSuccess) {
    return formContent;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a team</CardTitle>
        <CardDescription>
          Set up your team and start managing your schedule.
        </CardDescription>
      </CardHeader>
      <CardContent>{formContent}</CardContent>
    </Card>
  );
}
