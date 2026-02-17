"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
export function CreateTeamForm() {
  const [teamName, setTeamName] = useState("");
  const [season, setSeason] = useState("");
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be signed in.");
      setLoading(false);
      return;
    }

    // Generate IDs client-side to avoid needing .select() after insert.
    // This sidesteps the RLS chicken-and-egg problem: the SELECT policy on
    // teams requires the user to be a team_member, but that row doesn't
    // exist yet at insert time.
    const orgId = crypto.randomUUID();
    const { error: orgError } = await supabase
      .from("organizations")
      .insert({ id: orgId, name: orgName || teamName });

    if (orgError) {
      setError(orgError.message);
      setLoading(false);
      return;
    }

    const teamId = crypto.randomUUID();
    const { error: teamError } = await supabase
      .from("teams")
      .insert({
        id: teamId,
        organization_id: orgId,
        name: teamName,
        season: season || null,
      });

    if (teamError) {
      setError(teamError.message);
      setLoading(false);
      return;
    }

    // Add current user as coach
    const { error: memberError } = await supabase
      .from("team_members")
      .insert({
        team_id: teamId,
        profile_id: user.id,
        role: "coach",
      });

    if (memberError) {
      setError(memberError.message);
      setLoading(false);
      return;
    }

    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create a team</CardTitle>
        <CardDescription>
          Set up your team and start managing your schedule.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="orgName">Club / organization name</Label>
            <Input
              id="orgName"
              placeholder="e.g. Westside FC"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>
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
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Creating..." : "Create team"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
