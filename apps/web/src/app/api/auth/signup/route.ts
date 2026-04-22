import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  sendEmail,
  buildConfirmationEmailHtml,
} from "@/lib/notifications/email";
import { getTenantFromHeaders } from "@/lib/supabase/tenant";
import { signupLimiter, rateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
  const { success } = await signupLimiter.limit(ip);
  if (!success) return rateLimitResponse();

  const body = await request.json();
  const { email, password, firstName, lastName, inviteId } = body as {
    email: string;
    password: string;
    firstName: string;
    lastName?: string;
    inviteId?: string;
  };

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  // Resolve branding and base URL from the tenant the user signed up on
  const tenant = getTenantFromHeaders(await headers());
  const brandName = tenant?.isWhiteLabel ? (tenant.orgNamePublic ?? undefined) : undefined;
  const logoUrl = tenant?.logoUrl ?? undefined;

  // Derive the base URL from the request origin so confirmation links land
  // on the correct host (club subdomain or lista.team)
  const origin = new URL(request.url).origin;
  const redirectTo = `${origin}/auth/confirm${
    inviteId ? `?next=/invite/${inviteId}` : ""
  }`;

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: {
      data: {
        first_name: firstName ?? "",
        last_name: lastName ?? "",
      },
      redirectTo,
    },
  });

  if (error) {
    const alreadyExists =
      error.message.toLowerCase().includes("already registered") ||
      error.message.toLowerCase().includes("already been registered");
    return NextResponse.json(
      {
        error: alreadyExists
          ? "An account with this email already exists. Please sign in instead."
          : "Something went wrong. Please try again.",
      },
      { status: 400 }
    );
  }

  const confirmUrl = data.properties.action_link;
  const platform = brandName ?? "Lista";

  try {
    await sendEmail({
      to: email,
      subject: `Confirm your ${platform} account`,
      html: buildConfirmationEmailHtml({ confirmUrl, firstName, brandName, logoUrl }),
      brandName,
    });
  } catch (err) {
    console.error("Failed to send confirmation email:", err);
    return NextResponse.json(
      {
        error:
          "Account created but confirmation email could not be sent. Please contact support.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
