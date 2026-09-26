"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useNavigate } from "@/components/layout/navigation-progress";

export function WrongEmailClient({
  inviteId,
}: {
  inviteId: string;
}) {
  const { navigate } = useNavigate();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.signOut().then(() => {
      navigate(`/invite/${inviteId}/login`);
    });
  }, [inviteId, navigate, supabase]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <p className="text-muted-foreground">Signing you out…</p>
    </div>
  );
}
