import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
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

  // Remove any existing expo token rows for this user (e.g., old token after reinstall)
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("profile_id", userId)
    .not("expo_push_token", "is", null);

  // Register the new token
  await supabase.from("push_subscriptions").insert({
    profile_id: userId,
    expo_push_token: token,
  });
}
