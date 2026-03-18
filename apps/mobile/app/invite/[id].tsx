import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSession } from "../_layout";
import { storePendingInvite } from "../_layout";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://lista.team";

type InviteDetails = {
  id: string;
  email: string;
  role: string;
  teamName: string;
  isManagerInvite: boolean;
};

export default function InviteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const router = useRouter();

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`${API_URL}/api/invite/${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setLoadError(data.error);
        } else {
          setInvite(data as InviteDetails);
        }
      })
      .catch(() => setLoadError("Failed to load invitation. Please check your connection."));
  }, [id]);

  async function handleAccept() {
    if (!session || !invite) return;
    setAccepting(true);

    const type = invite.isManagerInvite ? "manager" : "self";
    const token = session.access_token;

    const res = await fetch(`${API_URL}/api/invite/${invite.id}/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ type }),
    });

    const data = await res.json();
    setAccepting(false);

    if (!res.ok) {
      Alert.alert("Error", data.error ?? "Something went wrong");
      return;
    }

    setAccepted(true);
  }

  // ── Error / invalid invite ──────────────────────────────────────────────
  if (loadError) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorTitle}>
          {loadError === "Invitation already accepted"
            ? "Already accepted"
            : "Invalid invitation"}
        </Text>
        <Text style={styles.errorBody}>
          {loadError === "Invitation already accepted"
            ? "This invitation has already been accepted."
            : "This invite link is invalid or has expired."}
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => router.replace("/(app)")}>
          <Text style={styles.buttonText}>Go to app</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  if (!invite) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  // ── Accepted ────────────────────────────────────────────────────────────
  if (accepted) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.successTitle}>You're in!</Text>
        <Text style={styles.successBody}>You've joined {invite.teamName}.</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => router.replace("/(app)")}
        >
          <Text style={styles.buttonText}>Go to dashboard</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── Not signed in ───────────────────────────────────────────────────────
  if (!session) {
    return (
      <SafeAreaView style={styles.center}>
        <View style={styles.card}>
          <Text style={styles.teamName}>{invite.teamName}</Text>
          <Text style={styles.roleLabel}>You've been invited as {invite.role}</Text>
          <Text style={styles.signInPrompt}>
            Sign in or create an account to accept this invitation.
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={async () => {
              await storePendingInvite(invite.id);
              router.push("/(auth)/login");
            }}
          >
            <Text style={styles.buttonText}>Sign in</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={async () => {
              await storePendingInvite(invite.id);
              router.push("/(auth)/signup");
            }}
          >
            <Text style={styles.secondaryButtonText}>Create account</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Signed in: show accept UI ────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.center}>
      <View style={styles.card}>
        <Text style={styles.inviteHeading}>You're invited!</Text>
        <Text style={styles.teamName}>{invite.teamName}</Text>
        <Text style={styles.roleLabel}>
          {invite.isManagerInvite
            ? "You've been invited to manage a player on this team"
            : `Role: ${invite.role}`}
        </Text>
        <TouchableOpacity
          style={[styles.button, accepting && { opacity: 0.6 }]}
          onPress={handleAccept}
          disabled={accepting}
        >
          {accepting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Accept & join team</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => router.replace("/(app)")}
        >
          <Text style={styles.secondaryButtonText}>Decline</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: "#f9fafb",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 28,
    width: "100%",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  inviteHeading: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  teamName: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
  },
  roleLabel: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
  },
  signInPrompt: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginTop: 4,
  },
  button: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    width: "100%",
    marginTop: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: "center",
    width: "100%",
  },
  secondaryButtonText: {
    color: "#6b7280",
    fontSize: 15,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  errorBody: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 24,
  },
  successTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 8,
  },
  successBody: {
    fontSize: 16,
    color: "#6b7280",
    marginBottom: 24,
  },
});
