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
import { supabase } from "../../lib/supabase";
import { buildAcceptBody, type Identity } from "../../lib/invite-accept";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://lista.team";

type InviteDetails = {
  id: string;
  email: string;
  role: string;
  teamName: string;
  isManagerInvite: boolean;
  playerName?: string | null;
};

type ManagedChild = { id: string; first_name: string; last_name: string };

const RELATIONSHIPS = [
  { value: "mom", label: "Mom" },
  { value: "dad", label: "Dad" },
  { value: "guardian", label: "Guardian" },
];

export default function InviteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSession();
  const router = useRouter();

  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  // Who is accepting, and for whom (BUG-011). The screen used to assume the
  // signed-in person was the player.
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [relationship, setRelationship] = useState("");
  const [existingChildId, setExistingChildId] = useState("");
  const [managedChildren, setManagedChildren] = useState<ManagedChild[]>([]);

  useEffect(() => {
    if (!session) return;
    supabase
      .from("profile_managers")
      .select("managed_id, profiles!managed_id(id, first_name, last_name)")
      .eq("manager_id", session.user.id)
      .neq("managed_id", session.user.id)
      .then(({ data }) => {
        const children = (data ?? [])
          .map((link: { profiles: unknown }) => link.profiles as ManagedChild | null)
          .filter((child): child is ManagedChild => child !== null);
        setManagedChildren(children);
      });
  }, [session]);

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

    const built = buildAcceptBody({
      isManagerInvite: invite.isManagerInvite,
      identity,
      relationship,
      existingChildId,
    });
    if (!built.ok) {
      Alert.alert("One more thing", built.error);
      return;
    }

    setAccepting(true);
    const token = session.access_token;

    const res = await fetch(`${API_URL}/api/invite/${invite.id}/accept`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(built.body),
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
        {!invite.isManagerInvite && (
          <View style={styles.choiceBlock}>
            <Text style={styles.choiceHeading}>
              {invite.playerName ? `Are you ${invite.playerName}?` : "Who is joining?"}
            </Text>

            <TouchableOpacity
              style={[styles.choice, identity === "self" && styles.choiceSelected]}
              onPress={() => setIdentity("self")}
            >
              <Text style={styles.choiceText}>
                {invite.playerName ? `Yes, I am ${invite.playerName}` : "I am the player"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.choice, identity === "guardian" && styles.choiceSelected]}
              onPress={() => setIdentity("guardian")}
            >
              <Text style={styles.choiceText}>No, I am a parent / guardian</Text>
            </TouchableOpacity>

            {identity === "guardian" && (
              <View style={styles.guardianBlock}>
                <Text style={styles.fieldLabel}>Your relationship</Text>
                <View style={styles.pillRow}>
                  {RELATIONSHIPS.map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      style={[styles.pill, relationship === option.value && styles.pillSelected]}
                      onPress={() => setRelationship(option.value)}
                    >
                      <Text
                        style={[
                          styles.pillText,
                          relationship === option.value && styles.pillTextSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {managedChildren.length > 0 && (
                  <>
                    <Text style={styles.fieldLabel}>Which player is this?</Text>
                    <View style={styles.pillRow}>
                      {managedChildren.map((child) => (
                        <TouchableOpacity
                          key={child.id}
                          style={[styles.pill, existingChildId === child.id && styles.pillSelected]}
                          onPress={() => setExistingChildId(child.id)}
                        >
                          <Text
                            style={[
                              styles.pillText,
                              existingChildId === child.id && styles.pillTextSelected,
                            ]}
                          >
                            {[child.first_name, child.last_name].filter(Boolean).join(" ")}
                          </Text>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity
                        style={[styles.pill, existingChildId === "" && styles.pillSelected]}
                        onPress={() => setExistingChildId("")}
                      >
                        <Text
                          style={[styles.pillText, existingChildId === "" && styles.pillTextSelected]}
                        >
                          Someone else
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.hint}>
                      Choosing a player you already manage adds this team to them, instead of
                      creating a second record.
                    </Text>
                  </>
                )}
              </View>
            )}
          </View>
        )}

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
  choiceBlock: { width: "100%", marginTop: 16, gap: 8 },
  choiceHeading: { fontSize: 16, fontWeight: "600", color: "#0f172a", marginBottom: 4 },
  choice: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 12,
  },
  choiceSelected: { borderColor: "#0f172a", backgroundColor: "#f1f5f9" },
  choiceText: { fontSize: 15, color: "#0f172a" },
  guardianBlock: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#475569" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pillSelected: { borderColor: "#0f172a", backgroundColor: "#0f172a" },
  pillText: { fontSize: 14, color: "#0f172a" },
  pillTextSelected: { color: "#ffffff" },
  hint: { fontSize: 12, color: "#64748b" },
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
