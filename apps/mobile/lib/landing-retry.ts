import { Alert } from "react-native";

/**
 * The server did its part (a team created, an invitation accepted), but the
 * phone couldn't save where to land (review DC-004). Says so, and offers to
 * try again: `retry` repeats only the local save, never the server's part.
 * Resolves once the save works, or the person chooses Not now.
 */
export function offerRetry(message: string, retry: () => Promise<boolean>): Promise<void> {
  return new Promise((resolve) => {
    Alert.alert("Couldn't switch", message, [
      { text: "Not now", style: "cancel", onPress: () => resolve() },
      {
        text: "Try again",
        onPress: async () => {
          if (await retry()) resolve();
          else resolve(offerRetry(message, retry));
        },
      },
    ]);
  });
}
