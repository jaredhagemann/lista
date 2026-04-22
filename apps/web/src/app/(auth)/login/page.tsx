import { headers } from "next/headers";
import { getTenantFromHeaders } from "@/lib/supabase/tenant";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const tenant = getTenantFromHeaders(await headers());
  const appName = tenant?.isWhiteLabel ? (tenant.orgNamePublic ?? "lista") : "lista";
  const logoUrl = tenant?.logoUrl ?? null;

  return <LoginForm appName={appName} logoUrl={logoUrl} />;
}
