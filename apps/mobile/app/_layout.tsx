import "../global.css";
import { useEffect, useState, createContext, useContext } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { registerForPushNotifications } from "../lib/notifications";
import * as SecureStore from "expo-secure-store";

const AuthContext = createContext<Session | null>(null);

export function useSession() {
  return useContext(AuthContext);
}

const PENDING_INVITE_KEY = "pending_invite_id";

export async function storePendingInvite(inviteId: string) {
  await SecureStore.setItemAsync(PENDING_INVITE_KEY, inviteId);
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;

    const inAuthGroup = segments[0] === "(auth)";
    // Invite screen is accessible to both authenticated and unauthenticated users
    const onInviteScreen = segments[0] === "invite";

    if (!session && !inAuthGroup && !onInviteScreen) {
      router.replace("/(auth)/login");
    } else if (session && inAuthGroup) {
      router.replace("/(app)");
    }
  }, [session, segments]);

  // Register for push notifications and handle pending invite after sign-in
  useEffect(() => {
    if (!session) return;

    registerForPushNotifications(session.user.id);

    // If a pending invite was stored before login, navigate to it
    SecureStore.getItemAsync(PENDING_INVITE_KEY).then((inviteId) => {
      if (inviteId) {
        SecureStore.deleteItemAsync(PENDING_INVITE_KEY);
        router.replace(`/invite/${inviteId}`);
      }
    });
  }, [session?.user.id]);

  if (session === undefined) return null;

  return (
    <AuthContext.Provider value={session}>{children}</AuthContext.Provider>
  );
}

export default function RootLayout() {
  return (
    <AuthGate>
      <Slot />
    </AuthGate>
  );
}
