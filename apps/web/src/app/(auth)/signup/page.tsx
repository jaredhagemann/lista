import { Suspense } from "react";
import { headers } from "next/headers";
import { getTenantFromHeaders } from "@/lib/supabase/tenant";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  const tenant = getTenantFromHeaders(await headers());
  const appName = tenant?.isWhiteLabel ? (tenant.orgNamePublic ?? "lista") : "lista";
  const logoUrl = tenant?.logoUrl ?? null;

  return (
    <Suspense>
      <SignupForm appName={appName} logoUrl={logoUrl} />
    </Suspense>
  );
}
