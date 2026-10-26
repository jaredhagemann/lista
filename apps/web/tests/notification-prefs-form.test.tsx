// @vitest-environment jsdom
/**
 * The Notifications card in Settings: the account's email and push switches,
 * with the team switches in the same card (team-notification-controls §3.4).
 *
 * Each switch saves as it's flipped. Turning push on also registers this
 * browser, which the old "Enable push notifications" button used to do.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const mocks = vi.hoisted(() => {
  const calls: Array<{ op: string; values?: unknown }> = [];
  const state = {
    error: null as { message: string } | null,
    /** push_subscriptions rows this browser already has. */
    savedEndpoints: [] as string[],
  };
  return {
    calls,
    state,
    toast: { success: vi.fn(), error: vi.fn() },
    client: {
      from: (table: string) => ({
        upsert: (values: unknown) => {
          calls.push({ op: `upsert:${table}`, values });
          return Promise.resolve({ error: state.error });
        },
        insert: (values: unknown) => {
          calls.push({ op: `insert:${table}`, values });
          return Promise.resolve({ error: null });
        },
        select: () => {
          const filters: Record<string, unknown> = {};
          const chain = {
            eq: (column: string, value: unknown) => {
              filters[column] = value;
              return chain;
            },
            then: (resolve: (v: unknown) => unknown) =>
              resolve({
                data: state.savedEndpoints.includes(filters.endpoint as string) ? [{ id: "row" }] : [],
                error: null,
              }),
          };
          return chain;
        },
      }),
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({ createClient: () => mocks.client }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { NotificationPrefsForm } from "@/components/settings/notification-prefs-form";

const ME = "me-1";
const ENDPOINT = "https://push.example/abc";

const pushManager = {
  getSubscription: vi.fn(),
  subscribe: vi.fn(),
};

function browserSubscription() {
  return {
    endpoint: ENDPOINT,
    getKey: (name: string) => new Uint8Array(name === "auth" ? [1, 2] : [3, 4]).buffer,
  };
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.state.error = null;
  mocks.state.savedEndpoints = [];
  vi.clearAllMocks();
  pushManager.getSubscription.mockResolvedValue(null);
  pushManager.subscribe.mockResolvedValue(browserSubscription());
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} });
});

afterEach(cleanup);

const prefs = (email: boolean, push: boolean) =>
  ({ profile_id: ME, email_enabled: email, push_enabled: push }) as never;

function sw(name: "Email notifications" | "Push notifications") {
  return screen.getByRole("switch", { name });
}

describe("Notifications card", () => {
  it("holds the account switches and the teams section in one card, with no save or push button", () => {
    render(
      <NotificationPrefsForm profileId={ME} prefs={prefs(true, true)}>
        <p>teams go here</p>
      </NotificationPrefsForm>
    );

    const card = sw("Email notifications").closest("[data-slot=card]")!;
    expect(card).toBeTruthy();
    expect(card.contains(sw("Push notifications"))).toBe(true);
    expect(card.contains(screen.getByText("teams go here"))).toBe(true);
    expect(screen.queryByRole("button", { name: /save preferences/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /push notifications/i })).toBeNull();
  });

  it("saves email as soon as it's flipped", async () => {
    render(<NotificationPrefsForm profileId={ME} prefs={prefs(true, false)} />);

    fireEvent.click(sw("Email notifications"));

    await waitFor(() =>
      expect(mocks.calls).toContainEqual({
        op: "upsert:notification_preferences",
        values: { profile_id: ME, email_enabled: false, push_enabled: false },
      })
    );
    expect(sw("Email notifications").getAttribute("aria-checked")).toBe("false");
  });

  it("puts a switch back and says so when the save fails", async () => {
    mocks.state.error = { message: "permission denied" };
    render(<NotificationPrefsForm profileId={ME} prefs={prefs(true, false)} />);

    fireEvent.click(sw("Email notifications"));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(sw("Email notifications").getAttribute("aria-checked")).toBe("true");
  });

  it("registers this browser when push is turned on", async () => {
    render(<NotificationPrefsForm profileId={ME} prefs={prefs(true, false)} />);

    fireEvent.click(sw("Push notifications"));

    await waitFor(() =>
      expect(mocks.calls).toContainEqual({
        op: "insert:push_subscriptions",
        values: { profile_id: ME, endpoint: ENDPOINT, p256dh: btoa("\x03\x04"), auth: btoa("\x01\x02") },
      })
    );
    expect(mocks.calls).toContainEqual({
      op: "upsert:notification_preferences",
      values: { profile_id: ME, email_enabled: true, push_enabled: true },
    });
    expect(pushManager.subscribe).toHaveBeenCalled();
  });

  it("doesn't register a browser twice", async () => {
    pushManager.getSubscription.mockResolvedValue(browserSubscription());
    mocks.state.savedEndpoints = [ENDPOINT];
    render(<NotificationPrefsForm profileId={ME} prefs={prefs(true, false)} />);

    fireEvent.click(sw("Push notifications"));

    await waitFor(() => expect(sw("Push notifications").hasAttribute("disabled")).toBe(false));
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(mocks.calls.some((c) => c.op === "insert:push_subscriptions")).toBe(false);
  });

  it("keeps push on for the account when the browser blocks it, and says so", async () => {
    pushManager.subscribe.mockRejectedValue(new Error("NotAllowedError"));
    render(<NotificationPrefsForm profileId={ME} prefs={prefs(true, false)} />);

    fireEvent.click(sw("Push notifications"));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(expect.stringMatching(/browser/i)));
    expect(sw("Push notifications").getAttribute("aria-checked")).toBe("true");
  });

  it("turning push off leaves the browser's registration alone", async () => {
    render(<NotificationPrefsForm profileId={ME} prefs={prefs(true, true)} />);

    fireEvent.click(sw("Push notifications"));

    await waitFor(() =>
      expect(mocks.calls).toContainEqual({
        op: "upsert:notification_preferences",
        values: { profile_id: ME, email_enabled: true, push_enabled: false },
      })
    );
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(mocks.calls.some((c) => c.op.endsWith("push_subscriptions"))).toBe(false);
  });
});
