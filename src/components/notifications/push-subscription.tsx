"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";

export function PushSubscriptionButton() {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      setIsSupported(true);
      checkSubscription();
    }
  }, []);

  async function checkSubscription() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    setIsSubscribed(!!subscription);
  }

  async function subscribe() {
    setLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        toast.error("You must be signed in.");
        setLoading(false);
        return;
      }

      const key = subscription.getKey("p256dh");
      const auth = subscription.getKey("auth");

      if (!key || !auth) {
        toast.error("Failed to get push subscription keys.");
        setLoading(false);
        return;
      }

      const { error } = await supabase.from("push_subscriptions").insert({
        profile_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: btoa(String.fromCharCode(...new Uint8Array(key))),
        auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
      });

      if (error) {
        toast.error(error.message);
      } else {
        setIsSubscribed(true);
        toast.success("Push notifications enabled!");
      }
    } catch (err) {
      console.error("Push subscription failed:", err);
      toast.error("Failed to enable push notifications.");
    }

    setLoading(false);
  }

  async function unsubscribe() {
    setLoading(true);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await subscription.unsubscribe();

        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("profile_id", user.id)
            .eq("endpoint", subscription.endpoint);
        }
      }

      setIsSubscribed(false);
      toast.success("Push notifications disabled.");
    } catch (err) {
      console.error("Push unsubscribe failed:", err);
      toast.error("Failed to disable push notifications.");
    }

    setLoading(false);
  }

  if (!isSupported) return null;

  return (
    <Button
      variant="outline"
      onClick={isSubscribed ? unsubscribe : subscribe}
      disabled={loading}
    >
      {isSubscribed ? (
        <>
          <BellOff className="mr-2 h-4 w-4" />
          Disable push notifications
        </>
      ) : (
        <>
          <Bell className="mr-2 h-4 w-4" />
          Enable push notifications
        </>
      )}
    </Button>
  );
}
