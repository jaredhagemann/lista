import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { signupLimiter, rateLimitResponse } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "anonymous";
  const { success } = await signupLimiter.limit(ip);
  if (!success) return rateLimitResponse();

  const body = await request.json();
  const { email, password, firstName, lastName } = body as {
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
  };

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Create user with email pre-confirmed — no confirmation email sent.
  // The invite link itself serves as the verification.
  const { error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: firstName ?? "",
      last_name: lastName ?? "",
    },
  });

  if (error) {
    const alreadyExists =
      error.message.toLowerCase().includes("already registered") ||
      error.message.toLowerCase().includes("already been registered") ||
      error.message.toLowerCase().includes("already exists");
    return NextResponse.json(
      {
        error: alreadyExists ? "already_exists" : error.message,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true });
}
