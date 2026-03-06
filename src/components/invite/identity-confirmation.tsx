"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { acceptInvitationAsSelf, acceptInvitationAsGuardian } from "@/app/actions/invite";
import type { Database } from "@/types/database";

type Invitation = Database["public"]["Tables"]["invitations"]["Row"] & {
  teams: { name: string };
};
type UserProfile = Database["public"]["Tables"]["profiles"]["Row"];

export function IdentityConfirmation({
  invitation,
  userProfile,
}: {
  invitation: Invitation;
  userProfile: UserProfile;
}) {
  const router = useRouter();
  const [identity, setIdentity] = useState<"self" | "guardian" | null>(null);
  const [relationship, setRelationship] = useState("");
  const [guardianFirstName, setGuardianFirstName] = useState(
    userProfile.first_name ?? ""
  );
  const [guardianLastName, setGuardianLastName] = useState(
    userProfile.last_name ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playerName = [invitation.first_name, invitation.last_name]
    .filter(Boolean)
    .join(" ");

  async function handleContinue() {
    setLoading(true);
    setError(null);

    if (identity === "self") {
      const result = await acceptInvitationAsSelf(invitation.id);
      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }
      router.push("/dashboard/settings/profile");
    } else if (identity === "guardian") {
      if (!relationship) {
        setError("Please select your relationship.");
        setLoading(false);
        return;
      }
      const result = await acceptInvitationAsGuardian(invitation.id, {
        relationship,
        firstName: guardianFirstName || undefined,
        lastName: guardianLastName || undefined,
      });
      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }
      router.push("/dashboard/settings/profile");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl font-bold">
            Are you {playerName}?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setIdentity("self")}
              className={`flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                identity === "self"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  identity === "self"
                    ? "border-primary"
                    : "border-muted-foreground"
                }`}
              >
                {identity === "self" && (
                  <span className="h-2 w-2 rounded-full bg-primary" />
                )}
              </span>
              <span>Yes, I am {playerName}</span>
            </button>

            <button
              type="button"
              onClick={() => setIdentity("guardian")}
              className={`flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors ${
                identity === "guardian"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <span
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                  identity === "guardian"
                    ? "border-primary"
                    : "border-muted-foreground"
                }`}
              >
                {identity === "guardian" && (
                  <span className="h-2 w-2 rounded-full bg-primary" />
                )}
              </span>
              <span>No, I am a parent / guardian</span>
            </button>
          </div>

          {identity === "guardian" && (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-2">
                <Label htmlFor="relationship">Your relationship</Label>
                <Select value={relationship} onValueChange={setRelationship}>
                  <SelectTrigger id="relationship">
                    <SelectValue placeholder="Select relationship" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mom">Mom</SelectItem>
                    <SelectItem value="dad">Dad</SelectItem>
                    <SelectItem value="guardian">Guardian</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="guardian-first-name">Your first name</Label>
                  <Input
                    id="guardian-first-name"
                    value={guardianFirstName}
                    onChange={(e) => setGuardianFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="guardian-last-name">Your last name</Label>
                  <Input
                    id="guardian-last-name"
                    value={guardianLastName}
                    onChange={(e) => setGuardianLastName(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            disabled={!identity || loading}
            onClick={handleContinue}
          >
            {loading ? "Joining team..." : "Continue"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
