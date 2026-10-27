import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function browserPushSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/**
 * Registers this browser for web push: asks for permission if it hasn't been
 * given, then records the subscription once. Throws when the browser refuses.
 */
export async function registerBrowserPush(db: SupabaseClient<Database>, profileId: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    }));

  const { data: existing, error: readError } = await db
    .from("push_subscriptions")
    .select("id")
    .eq("profile_id", profileId)
    .eq("endpoint", subscription.endpoint);
  if (readError) throw new Error(readError.message);
  if (existing && existing.length > 0) return;

  const key = subscription.getKey("p256dh");
  const auth = subscription.getKey("auth");
  if (!key || !auth) throw new Error("The browser gave no push keys.");

  const { error } = await db.from("push_subscriptions").insert({
    profile_id: profileId,
    endpoint: subscription.endpoint,
    p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
    auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
  });
  if (error) throw new Error(error.message);
}
