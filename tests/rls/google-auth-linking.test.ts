import { describe, it, expect, afterAll } from "vitest";
import { adminClient } from "./helpers";

// Pin the load-bearing anti-duplicate invariant from spec R5: when Supabase
// automatic identity linking attaches a Google identity to an existing
// email/password `auth.users` row, the `handle_new_user()` trigger MUST NOT
// re-fire — i.e. exactly one `profiles` row and exactly one `'Self'`
// `profile_managers` row remain for that user.
//
// Why this matters: the user-facing promise is "one account per email". If the
// trigger ever started firing on UPDATE (or on identity-link), every Google
// sign-in by a returning user would either explode (PK conflict on
// `profiles.id`) or — worse, if the conflict was silently absorbed — produce
// drifted state. Auto-linking is the entire reason we can avoid a manual
// "merge accounts" UX, so it MUST stay safe.
//
// How we simulate linking without live OAuth:
//   - The actual linking flow (a) creates a new row in `auth.identities` and
//     (b) merges Google's userinfo claims into `auth.users.raw_user_meta_data`
//     on the EXISTING user. It does NOT insert a new `auth.users` row — that
//     is precisely why `handle_new_user()` (an INSERT trigger on `auth.users`)
//     does not fire.
//   - Step (a) is irrelevant to the trigger; the trigger is bound to
//     `auth.users` INSERT, not `auth.identities`. Skipping it does not weaken
//     the invariant — if the trigger fired on UPDATE, step (b) alone would
//     already cause the regression this test catches.
//   - We therefore simulate linking with
//     `adminClient.auth.admin.updateUserById(...)`, applying the OAuth-shaped
//     metadata Google would send. If the trigger is ever changed in a way
//     that re-fires on UPDATE, this test fails.

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await adminClient.from("profile_managers").delete().eq("manager_id", id);
    await adminClient.from("profile_managers").delete().eq("managed_id", id);
    await adminClient.from("profiles").delete().eq("id", id);
    await adminClient.auth.admin.deleteUser(id);
  }
  createdUserIds.length = 0;
});

async function createEmailPasswordUser(): Promise<{ userId: string; email: string }> {
  const email = `linking-test-${crypto.randomUUID()}@test.local`;
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password: "test-password-123!",
    email_confirm: true,
    user_metadata: { first_name: "Existing", last_name: "User" },
  });
  if (error) throw new Error(`Failed to create email/password user: ${error.message}`);
  createdUserIds.push(data.user.id);
  return { userId: data.user.id, email };
}

async function countProfileRows(userId: string): Promise<number> {
  const { count, error } = await adminClient
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("id", userId);
  if (error) throw new Error(`Failed to count profile rows: ${error.message}`);
  return count ?? 0;
}

async function countSelfManagerRows(userId: string): Promise<number> {
  const { count, error } = await adminClient
    .from("profile_managers")
    .select("manager_id", { count: "exact", head: true })
    .eq("manager_id", userId)
    .eq("managed_id", userId);
  if (error) throw new Error(`Failed to count profile_managers rows: ${error.message}`);
  return count ?? 0;
}

describe("handle_new_user() — account linking invariant (R5)", () => {
  it("does not re-fire when an existing user's metadata is updated to include Google's OAuth claims", async () => {
    const { userId } = await createEmailPasswordUser();

    // Sanity: the email/password signup created exactly one profile + one
    // 'Self' row. If this baseline ever broke, the linking assertion below
    // would be meaningless.
    expect(await countProfileRows(userId)).toBe(1);
    expect(await countSelfManagerRows(userId)).toBe(1);

    const { data: beforeProfile, error: beforeError } = await adminClient
      .from("profiles")
      .select("id, auth_user_id, first_name, last_name, email")
      .eq("id", userId)
      .single();
    if (beforeError) throw new Error(`Failed to read profile pre-link: ${beforeError.message}`);

    // Simulate Supabase's auto-link: the existing auth.users row gains Google
    // claims in raw_user_meta_data. (In production, a new auth.identities row
    // would also appear for the same user_id, but the trigger doesn't watch
    // that table; the dangerous regression we're guarding against is
    // "trigger now fires on UPDATE", which this single call would expose.)
    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      user_metadata: {
        iss: "https://accounts.google.com",
        sub: "google-oauth-linking-1",
        provider_id: "google-oauth-linking-1",
        name: "Existing User",
        full_name: "Existing User",
        given_name: "Existing",
        family_name: "User",
        email_verified: true,
        picture: "https://lh3.googleusercontent.com/a/linking-test",
      },
    });
    if (updateError) throw new Error(`Failed to simulate identity-link metadata merge: ${updateError.message}`);

    // The core invariant: still exactly one of each row. If the trigger
    // re-fired we'd see either a PK violation surfaced earlier or — if the
    // trigger were modified to ON CONFLICT DO NOTHING the profile insert but
    // still re-insert the 'Self' row — a duplicate manager row.
    expect(await countProfileRows(userId)).toBe(1);
    expect(await countSelfManagerRows(userId)).toBe(1);

    // And the profile row is the SAME row — no orphan replacement.
    const { data: afterProfile, error: afterError } = await adminClient
      .from("profiles")
      .select("id, auth_user_id, first_name, last_name, email")
      .eq("id", userId)
      .single();
    if (afterError) throw new Error(`Failed to read profile post-link: ${afterError.message}`);

    expect(afterProfile.id).toBe(beforeProfile.id);
    expect(afterProfile.auth_user_id).toBe(beforeProfile.auth_user_id);
    expect(afterProfile.email).toBe(beforeProfile.email);
    // Names from the original email/password signup must NOT have been
    // overwritten by the linked Google identity (the spec is explicit: linking
    // attaches an identity, it does not rewrite the existing profile).
    expect(afterProfile.first_name).toBe(beforeProfile.first_name);
    expect(afterProfile.last_name).toBe(beforeProfile.last_name);
  });

  it("rejects a second auth.users row for the same email — the mechanism that prevents the trigger from double-firing", async () => {
    // The reason auto-linking is safe is upstream: Supabase refuses to create
    // a second auth.users row for an email that already has a confirmed user.
    // If that ever regressed (e.g. a config change that allowed duplicates),
    // handle_new_user() would fire a second time and produce a second
    // profiles row under a different id. Pin the upstream guarantee here so
    // the regression surfaces in *this* file rather than as a mystery
    // duplicate in production.
    const { email } = await createEmailPasswordUser();

    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        given_name: "Duplicate",
        family_name: "Attempt",
        email_verified: true,
      },
    });

    // We expect a failure. If Supabase ever silently succeeds, capture the
    // duplicate id for cleanup so the test run stays hermetic.
    if (data?.user?.id) createdUserIds.push(data.user.id);

    expect(error).not.toBeNull();
    expect(data?.user ?? null).toBeNull();
  });
});
