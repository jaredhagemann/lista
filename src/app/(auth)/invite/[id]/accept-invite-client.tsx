"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Database } from "@/types/database";

type TeamMemberRole = Database["public"]["Tables"]["team_members"]["Row"]["role"];

export function AcceptInviteClient({
  invitationId,
  teamName,
  role,
  teamId,
}: {
  invitationId: string;
  teamName: string;
  role: TeamMemberRole;
  teamId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  async function handleAccept() {
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be signed in to accept an invitation.");
      setLoading(false);
      return;
    }

    // Add user to team
    const { error: memberError } = await supabase.from("team_members").insert({
      team_id: teamId,
      profile_id: user.id,
      role,
    });

    if (memberError) {
      if (memberError.code === "23505") {
        // Already a member, just mark invite as accepted and redirect
      } else {
        setError(memberError.message);
        setLoading(false);
        return;
      }
    }

    // Mark invitation as accepted
    await supabase
      .from("invitations")
      .update({ accepted_at: new Date().toISOString() })
      .eq("id", invitationId);

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">
            You&apos;re invited!
          </CardTitle>
          <CardDescription>
            You&apos;ve been invited to join a team on lista
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div>
            <p className="text-lg font-semibold">{teamName}</p>
            <Badge variant="secondary" className="mt-1 capitalize">
              {role}
            </Badge>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleAccept}
            className="w-full"
            disabled={loading}
          >
            {loading ? "Joining..." : "Accept & join team"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
