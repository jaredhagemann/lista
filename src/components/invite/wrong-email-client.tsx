"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function WrongEmailClient({
  inviteId,
}: {
  inviteId: string;
}) {
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.signOut().then(() => {
      router.push(`/invite/${inviteId}/login`);
    });
  }, [inviteId, router, supabase]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <p className="text-muted-foreground">Signing you out…</p>
    </div>
  );
}
