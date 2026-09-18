/**
 * Native senders announce their messages (BUG-007, gaps 1 and 4).
 *
 * A message typed on a phone used to reach nobody's lock screen: the app
 * inserted the row and never called the notification route. And registering a
 * device deleted every other Expo token the person had, so a second device
 * switched off the first.
 */

import { notifyChatMessage } from "../lib/chat-notify";
import { registerPushToken } from "../lib/notifications";

jest.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession: jest.fn() }, from: jest.fn() },
}));

describe("notifyChatMessage", () => {
  const deps = (token: string | null, fetchImpl: jest.Mock) => ({
    getAccessToken: async () => token,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    apiUrl: "https://lista.team",
  });

  it("posts the message to the notify route with the user's bearer token", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true }));

    await notifyChatMessage({ messageId: "m1", channelId: "c1" }, deps("jwt-123", fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://lista.team/api/chat/notify");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer jwt-123");
    expect(JSON.parse(init.body as string)).toEqual({ messageId: "m1", channelId: "c1" });
  });

  it("carries a direct message's channel instead", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true }));

    await notifyChatMessage({ messageId: "m2", dmChannelId: "d1" }, deps("jwt-123", fetchImpl));

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ messageId: "m2", dmChannelId: "d1" });
  });

  it("does nothing without a session", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true }));

    await notifyChatMessage({ messageId: "m3", channelId: "c1" }, deps(null, fetchImpl));

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never throws when the network is down — the message is already sent", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("Network request failed");
    });

    await expect(
      notifyChatMessage({ messageId: "m4", channelId: "c1" }, deps("jwt-123", fetchImpl))
    ).resolves.toBeUndefined();
  });
});

describe("registerPushToken", () => {
  it("upserts on the token, leaving the person's other devices alone", async () => {
    const upsert = jest.fn(async () => ({ error: null }));
    const del = jest.fn();
    const client = { from: jest.fn(() => ({ upsert, delete: del })) };

    await registerPushToken(client as never, "user-1", "ExponentPushToken[tablet]");

    expect(client.from).toHaveBeenCalledWith("push_subscriptions");
    expect(upsert).toHaveBeenCalledWith(
      { profile_id: "user-1", expo_push_token: "ExponentPushToken[tablet]" },
      { onConflict: "expo_push_token" }
    );
    // The old code deleted every other Expo row for this user first.
    expect(del).not.toHaveBeenCalled();
  });
});
