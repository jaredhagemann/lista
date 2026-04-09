"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearActiveProfile } from "@/app/actions/team";
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

export function CreateTeamForm({ onSuccess }: { onSuccess?: () => void } = {}) {
  const [teamName, setTeamName] = useState("");
  const [season, setSeason] = useState("");
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamName, season: season || undefined, orgName: orgName || undefined }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    if (onSuccess) {
      onSuccess();
    } else {
      // Clear any active managed-profile cookie before redirecting so the
      // dashboard layout resolves to the own profile on the new team.
      await clearActiveProfile();
      router.push("/dashboard");
      router.refresh();
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
