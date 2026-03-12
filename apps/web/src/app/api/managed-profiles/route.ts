import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export async function POST(request: Request) {
  // Authenticate via Bearer token (mobile sends the Supabase session JWT)
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const anonClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const { data: { user } } = await anonClient.auth.getUser(token);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { firstName, lastName, relationship, birthday } = body as {
    firstName: string;
    lastName?: string;
    relationship?: string;
    birthday?: string;
  };

  if (!firstName?.trim()) {
    return NextResponse.json({ error: "First name is required" }, { status: 400 });
  }

  // Use service role to create the managed profile (no auth account)
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Find the manager's profile (auth_user_id = user.id)
  const { data: managerProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!managerProfile) {
    return NextResponse.json({ error: "Manager profile not found" }, { status: 404 });
  }

  // Create the managed profile (no auth_user_id)
  const profileId = crypto.randomUUID();
  const { error: profileError } = await admin.from("profiles").insert({
    id: profileId,
    first_name: firstName.trim(),
    last_name: lastName?.trim() || undefined,
    birthday: birthday || undefined,
    email: `managed-${profileId.slice(0, 8)}@lista.internal`,
  });

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  // Link manager → managed profile
  const { error: linkError } = await admin.from("profile_managers").insert({
    manager_id: managerProfile.id,
    managed_id: profileId,
    relationship: relationship?.trim() || null,
  });

  if (linkError) {
    // Clean up the profile we just created
    await admin.from("profiles").delete().eq("id", profileId);
    return NextResponse.json({ error: linkError.message }, { status: 500 });
  }

  return NextResponse.json({
    profile: {
      id: profileId,
      first_name: firstName.trim(),
      last_name: lastName?.trim() || null,
      birthday: birthday || null,
    },
  });
}
