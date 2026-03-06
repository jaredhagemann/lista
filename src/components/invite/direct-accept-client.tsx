"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { acceptInvitationAsSelf } from "@/app/actions/invite";

export function DirectAcceptClient({
  invitationId,
  teamName,
  role,
}: {
  invitationId: string;
  teamName: string;
  role: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setLoading(true);
    setError(null);
    const result = await acceptInvitationAsSelf(invitationId);
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    router.push("/dashboard/settings/profile");
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
