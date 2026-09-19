/**
 * Expo tells us when a push failed; we have to listen (BUG-007 follow-up).
 *
 * sendExpoPushNotification logged a rejected ticket and returned normally, so
 * the worker recorded the delivery as "sent". D3's whole point is that a
 * delivery record means something: "sent" is meant to be "the service accepted
 * it", and a rejected ticket is the service saying it did not.
 *
 * A token Expo reports as DeviceNotRegistered is dead — the app was uninstalled,
 * or the token was reissued — and it is removed rather than retried forever.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  tickets: [] as unknown[],
  sendPushNotificationsAsync: vi.fn(),
}));

vi.mock("expo-server-sdk", () => ({
  Expo: class {
    static isExpoPushToken(token: string) {
      return token.startsWith("ExponentPushToken[");
    }
    sendPushNotificationsAsync = mocks.sendPushNotificationsAsync;
  },
}));

import { sendExpoPushNotification, isDeadTokenError } from "@/lib/notifications/expo-push";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendPushNotificationsAsync.mockImplementation(async () => mocks.tickets);
});

function ticket(t: unknown) {
  mocks.tickets = [t];
}

describe("sending an Expo push", () => {
  it("returns quietly when the service accepts it", async () => {
    ticket({ status: "ok", id: "receipt-1" });

    await expect(
      sendExpoPushNotification("ExponentPushToken[live]", { title: "Hi", body: "There" })
    ).resolves.toBeUndefined();
  });

  it("throws when the service rejects it, so the delivery is recorded as failed", async () => {
    ticket({
      status: "error",
      message: '"ExponentPushToken[dead]" is not a registered push notification recipient',
      details: { error: "DeviceNotRegistered" },
    });

    await expect(
      sendExpoPushNotification("ExponentPushToken[dead]", { title: "Hi", body: "There" })
    ).rejects.toThrow(/not a registered push notification recipient/);
  });

  it("throws for a token that is not an Expo token at all", async () => {
    await expect(
      sendExpoPushNotification("not-a-token", { title: "Hi", body: "There" })
    ).rejects.toThrow(/Invalid Expo push token/);
    expect(mocks.sendPushNotificationsAsync).not.toHaveBeenCalled();
  });
});

describe("recognising a dead token", () => {
  it("knows DeviceNotRegistered", () => {
    const error = Object.assign(new Error("gone"), { expoError: "DeviceNotRegistered" });

    expect(isDeadTokenError(error)).toBe(true);
  });

  it("does not treat a transient failure as dead", () => {
    expect(isDeadTokenError(new Error("network timeout"))).toBe(false);
    expect(isDeadTokenError(Object.assign(new Error("slow down"), { expoError: "MessageRateExceeded" }))).toBe(
      false
    );
  });
});
