// @vitest-environment jsdom
/**
 * An open club's owner is told why they cannot delete their account (BUG-013).
 *
 * /api/account/delete refuses with owns_club; the settings screen names the
 * club and points to club settings, where ownership can be handed over or the
 * club closed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ push: vi.fn(), fetch: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) } }),
}));
vi.mock("@/app/dashboard/settings/actions", () => ({ changePassword: vi.fn() }));

import { AccountSettings } from "@/components/settings/account-settings";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ error: "owns_club", clubs: ["Westside FC"] }), { status: 409 })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("deleting the account of an open club's owner", () => {
  it("names the club and points to club settings", async () => {
    render(<AccountSettings />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Account" }));

    expect(await screen.findByText(/Westside FC/)).toBeTruthy();
    expect(screen.getByText(/hand the club over/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Go to Club Settings" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard/club/settings"));
  });
});
