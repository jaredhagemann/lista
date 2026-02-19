"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import type { Database } from "@/types/database";

type Team = Database["public"]["Tables"]["teams"]["Row"];

interface TeamSettingsFormProps {
  team: Team;
  isAdmin: boolean;
}

export function TeamSettingsForm({ team, isAdmin }: TeamSettingsFormProps) {
  const [editing, setEditing] = useState(false);
  const [teamName, setTeamName] = useState(team.name);
  const [season, setSeason] = useState(team.season ?? "");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  function handleCancel() {
    setTeamName(team.name);
    setSeason(team.season ?? "");
    setEditing(false);
  }

  async function handleSave() {
    setLoading(true);

    const { error } = await supabase
      .from("teams")
      .update({ name: teamName, season: season || null })
      .eq("id", team.id);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Team updated");
      router.refresh();
      setEditing(false);
    }

    setLoading(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Team Details</CardTitle>
        {isAdmin && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        {isAdmin && editing && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-4 items-center">
          <span className="text-sm font-medium text-muted-foreground">
            Team Name
          </span>
          {editing ? (
            <Input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              required
            />
          ) : (
            <span className="text-sm">{team.name}</span>
          )}

          <span className="text-sm font-medium text-muted-foreground">
            Season
          </span>
          {editing ? (
            <Input
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder="e.g. Spring 2026"
            />
          ) : (
            <span className="text-sm">{team.season ?? "—"}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
