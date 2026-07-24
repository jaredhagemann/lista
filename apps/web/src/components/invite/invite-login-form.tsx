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

export function InviteLoginForm({
  inviteId,
  email,
  brandName,
  logoUrl,
}: {
  inviteId: string;
  email: string;
  brandName?: string;
  logoUrl?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // R6: the invite must survive the OAuth round-trip — Supabase auto-links
  // a matching Google identity to the existing email/password user (R5) and
  // the callback returns us to `/invite/:id` to accept the invitation.
  const googleNext = `/invite/${inviteId}`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
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
          <CardDescription>
            Sign in as <strong>{email}</strong> to accept this invitation
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={anyLoading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link
                href={`/invite/${inviteId}/signup`}
                className="text-primary underline"
              >
                Sign up
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
