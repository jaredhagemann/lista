import { Expo, type ExpoPushMessage } from "expo-server-sdk";

const expo = new Expo();

export async function sendExpoPushNotification(
  expoPushToken: string,
  payload: { title: string; body: string; url?: string }
) {
  if (!Expo.isExpoPushToken(expoPushToken)) {
    console.error(`Invalid Expo push token: ${expoPushToken}`);
    return;
  }

  const message: ExpoPushMessage = {
    to: expoPushToken,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.url ? { url: payload.url } : {},
  };

  const [ticket] = await expo.sendPushNotificationsAsync([message]);

  if (ticket.status === "error") {
    console.error("Expo push notification error:", ticket.message, ticket.details);
  }
}
