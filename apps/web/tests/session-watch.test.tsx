// @vitest-environment jsdom
/**
 * BUG-036: a dashboard tab follows the signed-in account
 * (docs/bugs/fixed/036-web-tab-acts-as-another-signed-in-account.md).
 *
 * The page is rendered for one user. When the session turns out to be another
 * user's, the tab does a full reload of /dashboard; when it has ended, it goes
 * to /login; a token refresh for the same user changes nothing (decided
 * 2026-10-16). A session changed in another tab is noticed when this one is
 * shown again.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

type AuthCallback = (event: string, session: { user: { id: string } } | null) => void;

const mocks = vi.hoisted(() => {
  const state = {
    callback: null as AuthCallback | null,
    unsubscribed: false,
    user: { data: { user: { id: "user-a" } as { id: string } | null }, error: null as unknown },
  };
  const client = {
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        state.callback = cb;
        return { data: { subscription: { unsubscribe: () => (state.unsubscribed = true) } } };
      },
      getUser: async () => state.user,
    },
  };
  return { state, client };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));

import { AuthSessionMissingError } from "@supabase/supabase-js";
import { SessionWatch } from "@/components/layout/session-watch";

const assign = vi.fn();
const realLocation = window.location;

beforeEach(() => {
  assign.mockClear();
  mocks.state.callback = null;
  mocks.state.unsubscribed = false;
  mocks.state.user = { data: { user: { id: "user-a" } }, error: null };
  Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, assign } });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

const emit = (event: string, userId: string | null) =>
  act(() => mocks.state.callback!(event, userId ? { user: { id: userId } } : null));

async function showTab() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await Promise.resolve();
  });
}

describe("BUG-036: the tab follows the signed-in account", () => {
  it("a sign-in as another account reloads the dashboard as that account", () => {
    render(<SessionWatch userId="user-a" />);

    emit("SIGNED_IN", "user-b");

    expect(assign).toHaveBeenCalledWith("/dashboard");
  });

  it("signing out goes to the login page", () => {
    render(<SessionWatch userId="user-a" />);

    emit("SIGNED_OUT", null);

    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("a token refresh, or the first session event, for the same account changes nothing", () => {
    render(<SessionWatch userId="user-a" />);

    emit("INITIAL_SESSION", "user-a");
    emit("TOKEN_REFRESHED", "user-a");
    emit("SIGNED_IN", "user-a");

    expect(assign).not.toHaveBeenCalled();
  });

  it("coming back to the tab after another account signed in elsewhere reloads as it", async () => {
    render(<SessionWatch userId="user-a" />);
    mocks.state.user = { data: { user: { id: "user-b" } }, error: null };

    await showTab();

    expect(assign).toHaveBeenCalledWith("/dashboard");
  });

  it("coming back after the session ended elsewhere goes to the login page", async () => {
    render(<SessionWatch userId="user-a" />);
    mocks.state.user = { data: { user: null }, error: new AuthSessionMissingError() };

    await showTab();

    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("coming back with the same account, or when the check fails to reach the server, changes nothing", async () => {
    render(<SessionWatch userId="user-a" />);
    await showTab();

    mocks.state.user = { data: { user: null }, error: new Error("network down") };
    await showTab();

    expect(assign).not.toHaveBeenCalled();
  });

  it("stops listening when the page goes away", () => {
    const { unmount } = render(<SessionWatch userId="user-a" />);

    unmount();

    expect(mocks.state.unsubscribed).toBe(true);
  });
});
