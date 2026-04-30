"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ClubBrandingClient({
  org,
}: {
  org: {
    id: string;
    orgNamePublic: string | null;
    brandColor: string | null;
    brandColorSecondary: string | null;
    subdomain: string | null;
    logoUrl: string | null;
    faviconUrl: string | null;
  };
}) {
  const router = useRouter();

  const [orgNamePublic, setOrgNamePublic] = useState(org.orgNamePublic ?? "");
  const [brandColor, setBrandColor] = useState(org.brandColor ?? "#000000");
  const [brandColorSecondary, setBrandColorSecondary] = useState(
    org.brandColorSecondary ?? "#ffffff"
  );
  const [subdomain, setSubdomain] = useState(org.subdomain ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/club/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: org.id,
          orgNamePublic: orgNamePublic.trim() || null,
          brandColor: brandColor || null,
          brandColorSecondary: brandColorSecondary || null,
          subdomain: subdomain.trim().toLowerCase() || null,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        toast.error(error ?? "Failed to save branding");
        return;
      }
      toast.success("Branding saved");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Branding</h1>

      <form onSubmit={handleSave} className="space-y-6 max-w-md">
        <div className="space-y-2">
          <Label htmlFor="orgNamePublic">Public display name</Label>
          <Input
            id="orgNamePublic"
            value={orgNamePublic}
            onChange={(e) => setOrgNamePublic(e.target.value)}
            placeholder="e.g. Riverside Football Club"
          />
          <p className="text-xs text-muted-foreground">
            Shown to players and parents on your club portal.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="subdomain">Subdomain</Label>
          <div className="flex items-center gap-1">
            <Input
              id="subdomain"
              value={subdomain}
              onChange={(e) => setSubdomain(e.target.value.replace(/[^a-z0-9-]/g, ""))}
              placeholder="riverside-fc"
              className="flex-1"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">.lista.team</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Lowercase letters, numbers, and hyphens only.
          </p>
        </div>

        <div className="space-y-3">
          <Label>Brand colors</Label>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={brandColor}
                onChange={(e) => setBrandColor(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border p-0.5"
                aria-label="Primary color"
              />
              <span className="text-sm text-muted-foreground">Primary</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={brandColorSecondary}
                onChange={(e) => setBrandColorSecondary(e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border p-0.5"
                aria-label="Secondary color"
              />
              <span className="text-sm text-muted-foreground">Secondary</span>
            </div>
          </div>
        </div>

        {(org.logoUrl || org.faviconUrl) && (
          <div className="space-y-2">
            <Label>Current assets</Label>
            <div className="flex items-center gap-4">
              {org.logoUrl && (
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={org.logoUrl}
                    alt="Club logo"
                    className="h-12 w-auto rounded border object-contain"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Logo</p>
                </div>
              )}
              {org.faviconUrl && (
                <div className="text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={org.faviconUrl}
                    alt="Favicon"
                    className="h-8 w-8 rounded border object-contain"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Favicon</p>
                </div>
              )}
            </div>
          </div>
        )}

        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save branding"}
        </Button>
      </form>
    </div>
  );
}
