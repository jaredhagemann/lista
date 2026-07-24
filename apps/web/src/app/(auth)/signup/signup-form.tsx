"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
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

export function SignupForm({
  appName = "lista",
  logoUrl = null,
}: {
  appName?: string;
  logoUrl?: string | null;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const searchParams = useSearchParams();
  const inviteId = searchParams.get("invite");
  // R6: an invite must survive the OAuth round-trip, so we ask the
  // callback to land the user back on `/invite/:id` after Google. Without
  // an invite, the default landing is the dashboard (R2 — the same call
  // creates the account on first use and signs in on subsequent use).
  const googleNext = inviteId ? `/invite/${inviteId}` : "/dashboard";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, firstName, lastName, inviteId }),
    });

    const result = await response.json();

    if (!response.ok) {
      setError(result.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
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

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">Check your email</CardTitle>
            <CardDescription>
              We sent a confirmation link to <strong>{email}</strong>. Click the
              link to activate your account.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {logoUrl ? (
            <div className="flex justify-center mb-2">
              <Image
                src={logoUrl}
                alt={appName}
                width={200}
                height={80}
                className="h-20 w-auto object-contain"
              />
            </div>
          ) : (
            <CardTitle className="text-2xl font-bold">{appName}</CardTitle>
          )}
          <CardDescription>
            {inviteId
              ? "Create your account to join the team"
              : "Create your account"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
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
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last name</Label>
                <Input
                  id="lastName"
                  type="text"
                  placeholder="Smith"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              <Link href="/login" className="text-primary underline">
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
