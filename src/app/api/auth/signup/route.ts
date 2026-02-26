import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  sendEmail,
  buildConfirmationEmailHtml,
} from "@/lib/notifications/email";

export async function POST(request: Request) {
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

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.NEXT_PUBLIC_VERCEL_URL
      ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
      : "http://localhost:3000");

  const redirectTo = `${appUrl}/auth/confirm${
    inviteId ? `?next=/invite/${inviteId}` : ""
  }`;

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

  try {
    await sendEmail({
      to: email,
      subject: "Confirm your lista account",
      html: buildConfirmationEmailHtml({ confirmUrl }),
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
