import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Configure how notifications are shown when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Request permission and register this device for Expo push notifications.
 * Upserts the token into push_subscriptions for the signed-in user.
 * Safe to call on every app launch — if permission is denied or we're on
 * Simulator (no token available), it silently returns.
 */
export async function registerForPushNotifications(userId: string) {
  // expo-notifications requires a physical device for push tokens on iOS
  if (Platform.OS === "ios") {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      return;
    }
  }

  let token: string;
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    token = result.data;
  } catch {
    // Running on Simulator or no network — silently skip
    return;
  }

  await registerPushToken(supabase, userId, token);
}

/**
 * Detaches this device from the signed-in account, before signing out.
 *
 * The token row is bound to whoever registered it, so leaving it behind means
 * the handset keeps buzzing for the previous account — and whoever signs in next
 * sees their notifications (BUG-007 follow-up). Best effort: if the token cannot
 * be read, there is nothing to detach.
 */
export async function unregisterForPushNotifications() {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await unregisterPushToken(supabase, token);
  } catch {
    // No token on this device (Simulator, permission denied, offline).
  }
}

export async function unregisterPushToken(client: SupabaseClient, token: string) {
  return client.from("push_subscriptions").delete().eq("expo_push_token", token);
}

/**
 * Records this device against the signed-in user.
 *
 * Registration used to delete every other Expo token the user had first, so
 * installing on a second device silently stopped delivery to the first
 * (BUG-007, gap 4). Upserting on the token keeps every device, refreshes the
 * row if the app is reinstalled, and moves the device to whoever signs in on it.
 */
export async function registerPushToken(
  client: SupabaseClient,
  userId: string,
  token: string
) {
  return client.from("push_subscriptions").upsert(
    { profile_id: userId, expo_push_token: token },
    { onConflict: "expo_push_token" }
  );
}
