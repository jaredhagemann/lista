import { supabase } from "./supabase";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://lista.team";

type NotifyArgs = {
  messageId: string;
  channelId?: string;
  dmChannelId?: string;
};

type Deps = {
  getAccessToken: () => Promise<string | null>;
  fetchImpl: typeof fetch;
  apiUrl: string;
};

const defaultDeps: Deps = {
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  fetchImpl: (...args) => fetch(...args),
  apiUrl: API_URL,
};

/**
 * Tells the server a message was sent, so it can push it to the other people in
 * the conversation (BUG-007, gap 1).
 *
 * Native senders used to insert the message and stop there, so a message typed
 * on a phone reached nobody's lock screen. The web client has always made this
 * call; mobile authenticates with a bearer token instead of a cookie.
 *
 * Best effort by design: the message is already saved, and a failed call costs a
 * notification, not the message.
 */
export async function notifyChatMessage(args: NotifyArgs, deps: Partial<Deps> = {}) {
  const { getAccessToken, fetchImpl, apiUrl } = { ...defaultDeps, ...deps };

  try {
    const token = await getAccessToken();
    if (!token) return;

    await fetchImpl(`${apiUrl}/api/chat/notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(args),
    });
  } catch {
    // Offline, or the server is unreachable: the message stands regardless.
  }
}
