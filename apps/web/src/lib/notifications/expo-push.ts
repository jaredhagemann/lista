import { Expo, type ExpoPushMessage } from "expo-server-sdk";

const expo = new Expo();

/** An Expo failure carries the service's own error code, when it gave one. */
export class ExpoPushError extends Error {
  readonly expoError?: string;

  constructor(message: string, expoError?: string) {
    super(message);
    this.name = "ExpoPushError";
    this.expoError = expoError;
  }
}

/**
 * True when Expo says this token will never work again — the app was
 * uninstalled, or the token was reissued. The row should go rather than be
 * retried forever (BUG-007).
 */
export function isDeadTokenError(error: unknown): boolean {
  return error instanceof Error && "expoError" in error
    ? (error as { expoError?: string }).expoError === "DeviceNotRegistered"
    : false;
}

/**
 * Sends one push through Expo.
 *
 * Throws when Expo does not accept the message, so the caller records a failed
 * delivery. It used to log the rejected ticket and return normally, which made
 * every delivery record read "sent" — including pushes to tokens Expo had
 * already told us were dead (BUG-007).
 */
export async function sendExpoPushNotification(
  expoPushToken: string,
  payload: { title: string; body: string; url?: string }
) {
  if (!Expo.isExpoPushToken(expoPushToken)) {
    throw new ExpoPushError(`Invalid Expo push token: ${expoPushToken}`);
  }

  const message: ExpoPushMessage = {
    to: expoPushToken,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.url ? { url: payload.url } : {},
  };

  const [ticket] = await expo.sendPushNotificationsAsync([message]);

  if (ticket?.status === "error") {
    throw new ExpoPushError(
      ticket.message ?? "Expo rejected the notification",
      (ticket.details as { error?: string } | undefined)?.error
    );
  }
}
