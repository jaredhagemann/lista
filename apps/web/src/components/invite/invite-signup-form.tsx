"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { signInWithGoogle } from "@/lib/auth/google";
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

export function InviteSignupForm({
  inviteId,
  email,
  firstName,
  lastName,
  brandName,
  logoUrl,
}: {
  inviteId: string;
  email: string;
  firstName: string;
  lastName: string;
  brandName?: string;
  logoUrl?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [form, setForm] = useState({
    firstName,
    lastName,
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // R6: the invite must survive the OAuth round-trip. Auto-link (R5) means
  // a Google identity matching the invite email lands on the same account
  // the email/password path would have created; a brand-new Google account
  // is created on first use. Either way we want to come back to
  // `/invite/:id` to accept.
  const googleNext = `/invite/${inviteId}`;

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth/invite-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.error === "already_exists") {
        setError(
          "An account with this email already exists. Sign in instead."
        );
      } else {
        setError(data.error ?? "Something went wrong. Please try again.");
      }
      setLoading(false);
      return;
    }

    // Sign in immediately — user is pre-confirmed
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: form.password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    router.push(`/invite/${inviteId}`);
    router.refresh();
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    setError(null);
    try {
      const { error } = await signInWithGoogle(googleNext);
      if (error) {
        setError(error.message);
        setGoogleLoading(false);
      }
      // Success path navigates away to Google; leave the button in its
      // loading state so the user doesn't double-click during the redirect.
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not start Google sign-in. Please try again.",
      );
      setGoogleLoading(false);
    }
  }

  const anyLoading = loading || googleLoading;

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={brandName ?? "Club logo"}
              className="mx-auto mb-2 h-20 w-auto object-contain"
            />
          ) : (
            <CardTitle className="text-2xl font-bold">
              {brandName ?? "lista"}
            </CardTitle>
          )}
          <CardDescription>Create your account to join the team</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}{" "}
              {error.includes("Sign in") && (
                <Link
                  href={`/invite/${inviteId}/login`}
                  className="underline"
                >
                  Sign in
                </Link>
              )}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGoogle}
            disabled={anyLoading}
            data-testid="google-auth-button"
          >
            <GoogleGlyph />
            {googleLoading ? "Redirecting…" : "Continue with Google"}
          </Button>
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>
        </CardContent>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First name</Label>
                <Input
                  id="firstName"
                  type="text"
                  placeholder="Jane"
                  value={form.firstName}
                  onChange={(e) => set("firstName", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  type="text"
                  placeholder="Smith"
                  value={form.lastName}
                  onChange={(e) => set("lastName", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                readOnly
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                required
                minLength={6}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={anyLoading}>
              {loading ? "Creating account..." : "Create account"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link
                href={`/invite/${inviteId}/login`}
                className="text-primary underline"
              >
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.44c-.28 1.4-1.08 2.59-2.3 3.39v2.82h3.71c2.17-2 3.64-4.96 3.64-8.45z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.71-2.82c-1.03.69-2.34 1.1-4.22 1.1-3.24 0-5.99-2.19-6.97-5.13H1.18v3.22C3.16 21.31 7.27 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.03 14.24c-.25-.69-.39-1.43-.39-2.24s.14-1.55.39-2.24V6.54H1.18A11.97 11.97 0 0 0 0 12c0 1.94.46 3.78 1.18 5.46l3.85-3.22z"
      />
      <path
        fill="#EA4335"
        d="M12 4.74c1.77 0 3.36.61 4.61 1.8l3.29-3.29C17.95 1.18 15.24 0 12 0 7.27 0 3.16 2.69 1.18 6.54l3.85 3.22C6.01 6.93 8.76 4.74 12 4.74z"
      />
    </svg>
  );
}
