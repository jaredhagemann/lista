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
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface InviteResult {
  emailSent: boolean;
  inviteUrl: string;
}

export function NewMemberForm({
  teamId,
  role,
}: {
  teamId: string;
  role: "player" | "manager" | "coach";
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    birthday: "",
    gender: "",
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [sentEmail, setSentEmail] = useState("");
  const [copied, setCopied] = useState(false);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/invitations/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          email: form.email,
          role,
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
          birthday: form.birthday || undefined,
          gender: form.gender || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Failed to send invitation");
        return;
      }

      setSentEmail(form.email);
      setResult({ emailSent: data.emailSent, inviteUrl: data.inviteUrl });
      toast.success(data.emailSent ? "Invitation sent!" : "Invitation created");
    } catch {
      toast.error("Failed to send invitation");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (result?.inviteUrl) {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function resetForm() {
    setForm({ firstName: "", lastName: "", email: "", birthday: "", gender: "" });
    setResult(null);
    setSentEmail("");
    setCopied(false);
  }

  if (result) {
    return (
      <div className="space-y-4">
        {result.emailSent ? (
          <p className="text-sm text-muted-foreground">
            Invitation sent to <strong>{sentEmail}</strong>.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Invitation created but the email could not be delivered. Share
              this link manually:
            </p>
            <div className="flex gap-2">
              <Input value={result.inviteUrl} readOnly />
              <Button variant="outline" size="icon" onClick={copyLink}>
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/dashboard/team")}>
            Back to team
          </Button>
          <Button onClick={resetForm}>Invite another</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="first-name">First name *</Label>
          <Input
            id="first-name"
            type="text"
            placeholder="Jane"
            value={form.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="last-name">Last name *</Label>
          <Input
            id="last-name"
            type="text"
            placeholder="Smith"
            value={form.lastName}
            onChange={(e) => set("lastName", e.target.value)}
            required
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email *</Label>
        <Input
          id="email"
          type="email"
          placeholder="player@example.com"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          required
        />
      </div>
      {role === "player" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="birthday">Birthday</Label>
            <Input
              id="birthday"
              type="date"
              value={form.birthday}
              onChange={(e) => set("birthday", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="gender">Gender</Label>
            <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
              <SelectTrigger id="gender">
                <SelectValue placeholder="Select gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="non-binary">Non-binary</SelectItem>
                <SelectItem value="prefer-not-to-say">Prefer not to say</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
      <div className="flex gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/dashboard/team")}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? "Sending..." : "Send invitation"}
        </Button>
      </div>
    </form>
  );
}
