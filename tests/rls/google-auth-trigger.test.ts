import { describe, it, expect, afterAll } from "vitest";
import { adminClient } from "./helpers";

// Tests that handle_new_user() — the trigger on auth.users INSERT — handles
// OAuth-shaped metadata (Google's payload uses given_name / family_name / name
// / full_name / picture, not first_name / last_name). Per spec R4 the trigger
// must derive first_name and last_name with this precedence:
//   first_name: first_name -> given_name -> first token of name/full_name -> email local-part
//   last_name:  last_name  -> family_name -> remainder of name/full_name   -> ''
// and populate avatar_url from `picture` only when null. The 'Self'
// profile_managers row from 20260306000002_self_manager_on_signup.sql must
// continue to be inserted exactly once.
//
// We simulate OAuth by calling adminClient.auth.admin.createUser with
// user_metadata shaped like Google's userinfo payload — no live OAuth round-trip.

const createdUserIds: string[] = [];

async function insertAuthUser(
  metadata: Record<string, unknown>,
  emailOverride?: string
): Promise<{ userId: string; email: string }> {
  const email = emailOverride ?? `oauth-test-${crypto.randomUUID()}@test.local`;
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: metadata,
  });
  if (error) throw new Error(`Failed to insert auth user: ${error.message}`);
  createdUserIds.push(data.user.id);
  return { userId: data.user.id, email };
}

async function getProfile(userId: string) {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id, auth_user_id, first_name, last_name, email, avatar_url")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`Failed to read profile: ${error.message}`);
  return data;
}

async function getSelfManagerRows(userId: string) {
  const { data, error } = await adminClient
    .from("profile_managers")
    .select("manager_id, managed_id, relationship")
    .eq("manager_id", userId)
    .eq("managed_id", userId);
  if (error) throw new Error(`Failed to read profile_managers: ${error.message}`);
  return data;
}

afterAll(async () => {
  for (const id of createdUserIds) {
    await adminClient.from("profile_managers").delete().eq("manager_id", id);
    await adminClient.from("profile_managers").delete().eq("managed_id", id);
    await adminClient.from("profiles").delete().eq("id", id);
    await adminClient.auth.admin.deleteUser(id);
  }
  createdUserIds.length = 0;
});

describe("handle_new_user() — OAuth-shaped metadata (R4)", () => {
  it("derives first_name from given_name and last_name from family_name when present", async () => {
    const picture = "https://lh3.googleusercontent.com/a/ada-avatar";
    const { userId } = await insertAuthUser({
      iss: "https://accounts.google.com",
      sub: "google-oauth-1",
      provider_id: "google-oauth-1",
      name: "Ada Lovelace",
      full_name: "Ada Lovelace",
      given_name: "Ada",
      family_name: "Lovelace",
      email_verified: true,
      picture,
    });

    const profile = await getProfile(userId);
    expect(profile.first_name).toBe("Ada");
    expect(profile.last_name).toBe("Lovelace");
    expect(profile.avatar_url).toBe(picture);
    expect(profile.auth_user_id).toBe(userId);
  });

  it("falls back to first token of `name` when given_name is absent", async () => {
    // Some OAuth payloads omit given_name/family_name and only ship a combined
    // `name`. The trigger must split it into first/last.
    const { userId } = await insertAuthUser({
      iss: "https://accounts.google.com",
      sub: "google-oauth-2",
      name: "Charles Babbage",
      email_verified: true,
    });

    const profile = await getProfile(userId);
    expect(profile.first_name).toBe("Charles");
    expect(profile.last_name).toBe("Babbage");
  });

  it("falls back to first token of `full_name` and joins the remainder for last_name", async () => {
    // Multi-word names should put the first token in first_name and the rest
    // (joined with a single space) in last_name.
    const { userId } = await insertAuthUser({
      full_name: "Grace Brewster Hopper",
      email_verified: true,
    });

    const profile = await getProfile(userId);
    expect(profile.first_name).toBe("Grace");
    expect(profile.last_name).toBe("Brewster Hopper");
  });

  it("falls back to the email local-part for first_name and '' for last_name when no name metadata is present", async () => {
    const email = `alanmturing-${crypto.randomUUID()}@test.local`;
    const { userId } = await insertAuthUser({ email_verified: true }, email);

    const profile = await getProfile(userId);
    expect(profile.first_name).toBe(email.split("@")[0]);
    expect(profile.last_name).toBe("");
  });

  it("populates avatar_url from `picture` on the OAuth path", async () => {
    const picture = "https://lh3.googleusercontent.com/a/picture-only";
    const { userId } = await insertAuthUser({
      given_name: "Pic",
      family_name: "Only",
      picture,
      email_verified: true,
    });

    const profile = await getProfile(userId);
    expect(profile.avatar_url).toBe(picture);
  });

  it("creates exactly one 'Self' profile_managers row for an OAuth signup", async () => {
    const { userId } = await insertAuthUser({
      given_name: "Self",
      family_name: "Once",
      picture: "https://lh3.googleusercontent.com/a/self-once",
      email_verified: true,
    });

    const rows = await getSelfManagerRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].relationship).toBe("Self");
  });
});

describe("handle_new_user() — email/password regression", () => {
  it("still derives first_name and last_name from raw first_name/last_name keys", async () => {
    // This is the existing email/password shape used by /api/auth/signup. It
    // must keep working after the migration extends the trigger for OAuth.
    const { userId } = await insertAuthUser({
      first_name: "Email",
      last_name: "Password",
    });

    const profile = await getProfile(userId);
    expect(profile.first_name).toBe("Email");
    expect(profile.last_name).toBe("Password");
  });

  it("prefers raw first_name/last_name over given_name/family_name when both are present", async () => {
    // Belt-and-suspenders: if a payload somehow contains both shapes, the
    // explicit first_name/last_name keys win per the R4 precedence.
    const { userId } = await insertAuthUser({
      first_name: "Explicit",
      last_name: "Wins",
      given_name: "Google",
      family_name: "Loses",
    });

    const profile = await getProfile(userId);
    expect(profile.first_name).toBe("Explicit");
    expect(profile.last_name).toBe("Wins");
  });

  it("creates the 'Self' profile_managers row for email/password signups", async () => {
    const { userId } = await insertAuthUser({
      first_name: "EP",
      last_name: "Self",
    });

    const rows = await getSelfManagerRows(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].relationship).toBe("Self");
  });
});
