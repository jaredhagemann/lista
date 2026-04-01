import { describe, it, expect, vi, beforeEach } from "vitest";

// redirect() throws in Next.js — mirror that so code after a redirect never runs
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("redirect"), { redirectUrl: url });
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/get-active-membership", () => ({
  getActiveMembership: vi.fn(),
}));

// Prevent the client component (and its browser-only deps) from loading
vi.mock("@/components/team/new-member-form", () => ({
  NewMemberForm: () => null,
}));

import { createClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/lib/get-active-membership";
import NewMemberPage from "@/app/dashboard/team/new-member/page";

const mockGetUser = vi.fn();

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createClient).mockResolvedValue({ auth: { getUser: mockGetUser } } as any);
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(getActiveMembership).mockResolvedValue({ role: "coach", team_id: "team-123" } as any);
});

/** Returns the redirect URL if the page called redirect(), otherwise null. */
async function captureRedirect(
  fn: () => Promise<unknown>
): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e: unknown) {
    const err = e as { redirectUrl?: string };
    if (err.redirectUrl !== undefined) return err.redirectUrl;
    throw e;
  }
}

function renderPage(role: string | undefined) {
  return NewMemberPage({ searchParams: Promise.resolve({ role }) });
}

describe("new-member page — role validation", () => {
  it("redirects to /dashboard/team for an unrecognised role", async () => {
    const url = await captureRedirect(() => renderPage("superadmin"));
    expect(url).toBe("/dashboard/team");
  });

  it("redirects to /dashboard/team when role is absent", async () => {
    const url = await captureRedirect(() => renderPage(undefined));
    expect(url).toBe("/dashboard/team");
  });

  it.each(["player", "manager", "coach"])(
    "accepts role=%s without redirecting",
    async (role) => {
      const url = await captureRedirect(() => renderPage(role));
      expect(url).toBeNull();
    }
  );
});

describe("new-member page — admin guard", () => {
  it("redirects to /dashboard/team when the caller is a player", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getActiveMembership).mockResolvedValue({ role: "player", team_id: "team-123" } as any);

    const url = await captureRedirect(() => renderPage("coach"));
    expect(url).toBe("/dashboard/team");
  });

  it("allows a coach to access the coach invite page", async () => {
    const url = await captureRedirect(() => renderPage("coach"));
    expect(url).toBeNull();
  });

  it("allows a manager to access the coach invite page", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getActiveMembership).mockResolvedValue({ role: "manager", team_id: "team-123" } as any);

    const url = await captureRedirect(() => renderPage("coach"));
    expect(url).toBeNull();
  });
});
