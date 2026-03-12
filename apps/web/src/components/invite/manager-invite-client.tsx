"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { acceptManagerInvitation } from "@/app/actions/invite";

export function ManagerInviteClient({
  invitationId,
  teamName,
  playerName,
  relationship,
}: {
  invitationId: string;
  teamName: string;
  playerName: string;
  relationship: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setLoading(true);
    setError(null);
    const result = await acceptManagerInvitation(invitationId);
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
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
            You&apos;ve been invited to manage a player on lista
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div>
            <p className="text-sm text-muted-foreground">Managing</p>
            <p className="text-lg font-semibold">{playerName}</p>
            <p className="text-sm text-muted-foreground">on {teamName}</p>
            {relationship && (
              <Badge variant="secondary" className="mt-2 capitalize">
                {relationship}
              </Badge>
            )}
          </div>
        </CardContent>
        <CardFooter>
          <Button
            onClick={handleAccept}
            className="w-full"
            disabled={loading}
          >
            {loading ? "Accepting..." : "Accept invitation"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
