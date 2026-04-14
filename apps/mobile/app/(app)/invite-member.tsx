import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { useAppContext } from "../../contexts/AppContext";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://lista.team";

type Role = "player" | "manager" | "coach";

const ROLES: Role[] = ["player", "manager", "coach"];

const RELATIONSHIPS = ["Self", "Mom", "Dad", "Guardian", "Other"];

const GENDERS = [
  { label: "Male", value: "male" },
  { label: "Female", value: "female" },
  { label: "Non-binary", value: "non-binary" },
  { label: "Prefer not to say", value: "prefer-not-to-say" },
];

type ConfirmResult = { emailSent: boolean; inviteUrl: string; sentTo: string };

export default function InviteMemberScreen() {
  const router = useRouter();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const { membership } = useAppContext();

  const isGuardianMode = !!memberId;

  // Guardian mode: resolved player profile
  const [guardianTeamId, setGuardianTeamId] = useState<string | null>(null);
  const [guardianProfileId, setGuardianProfileId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [role, setRole] = useState<Role>("player");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [gender, setGender] = useState("");
  const [relationship, setRelationship] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [sharing, setSharing] = useState(false);

  // Guardian mode: resolve and validate the member row on mount
  useEffect(() => {
    if (!isGuardianMode) return;

    async function resolveMember() {
      const { data, error: fetchError } = await supabase
        .from("team_members")
        .select("profile_id, team_id, role")
        .eq("id", memberId!)
        .single();

      if (fetchError || !data) {
        Alert.alert("Error", "Could not load member details.", [
          { text: "OK", onPress: () => router.back() },
        ]);
        return;
      }

      if (data.role !== "player") {
        // Defensive: guardian invites are only valid for players
        router.back();
        return;
      }

      setGuardianProfileId(data.profile_id);
      setGuardianTeamId(data.team_id);
    }

    resolveMember();
  }, [memberId]);

  function resetForm() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setBirthday("");
    setGender("");
    setRelationship("");
    setRole("player");
    setError(null);
    setResult(null);
    setSharing(false);
  }

  async function handleSubmit() {
    if (loading) return;
    setLoading(true);
    setError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setError("Not signed in.");
      setLoading(false);
      return;
    }

    const body = isGuardianMode
      ? {
          teamId: guardianTeamId,
          email,
          role: "manager",
          managedProfileId: guardianProfileId,
          relationship,
        }
      : {
          teamId: membership?.teamId,
          email,
          role,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          birthday: birthday || undefined,
          gender: gender || undefined,
        };

    try {
      const res = await fetch(`${API_URL}/api/invitations/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to send invitation.");
        return;
      }

      setResult({ emailSent: data.emailSent, inviteUrl: data.inviteUrl, sentTo: email });
    } catch {
      setError("Failed to send invitation. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  async function shareLink() {
    if (!result?.inviteUrl) return;
    setSharing(true);
    try {
      await Share.share({ message: result.inviteUrl });
    } finally {
      setSharing(false);
    }
  }

  const canSubmit = isGuardianMode
    ? email.trim().length > 0 && relationship.length > 0 && !!guardianTeamId
    : email.trim().length > 0 && firstName.trim().length > 0 && lastName.trim().length > 0;

  // ── Loading member in guardian mode ─────────────────────────────────────
  if (isGuardianMode && !guardianTeamId && !loadError) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <ActivityIndicator size="large" color="#0f172a" style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  // ── Confirmation state ───────────────────────────────────────────────────
  if (result) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.header}>
          <View style={styles.headerSpacer} />
          <Text style={styles.headerTitle}>Invitation Sent</Text>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {result.emailSent ? (
            <View style={styles.confirmCard}>
              <Ionicons name="checkmark-circle-outline" size={40} color="#16a34a" />
              <Text style={styles.confirmTitle}>Invitation sent!</Text>
              <Text style={styles.confirmBody}>
                An invitation was sent to <Text style={styles.bold}>{result.sentTo}</Text>.
              </Text>
            </View>
          ) : (
            <View style={styles.confirmCard}>
              <Ionicons name="warning-outline" size={40} color="#d97706" />
              <Text style={styles.confirmTitle}>Invitation created</Text>
              <Text style={styles.confirmBody}>
                We couldn't deliver the email. Share this link with the invitee:
              </Text>
              <TouchableOpacity
                style={[styles.shareButton, sharing && { opacity: 0.5 }]}
                onPress={shareLink}
                disabled={sharing}
              >
                <Ionicons name="share-outline" size={16} color="#374151" />
                <Text style={styles.shareButtonText}>Share invite link</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.confirmActions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={resetForm}>
              <Text style={styles.secondaryButtonText}>Invite another</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton} onPress={() => router.back()}>
              <Text style={styles.primaryButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerSpacer}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isGuardianMode ? "Add Contact" : "Invite Member"}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Role picker — general mode only */}
          {!isGuardianMode && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Role</Text>
              <View style={styles.roleRow}>
                {ROLES.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.roleChip, role === r && styles.roleChipActive]}
                    onPress={() => setRole(r)}
                  >
                    <Text style={[styles.roleChipText, role === r && styles.roleChipTextActive]}>
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* First / last name — general mode only */}
          {!isGuardianMode && (
            <View style={styles.nameRow}>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={styles.label}>
                  First name <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Jane"
                  placeholderTextColor="#9ca3af"
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                />
              </View>
              <View style={[styles.fieldGroup, { flex: 1 }]}>
                <Text style={styles.label}>
                  Last name <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Smith"
                  placeholderTextColor="#9ca3af"
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                />
              </View>
            </View>
          )}

          {/* Email */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              Email <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder="email@example.com"
              placeholderTextColor="#9ca3af"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {/* Birthday + gender — player general mode only */}
          {!isGuardianMode && role === "player" && (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Birthday</Text>
                <TextInput
                  style={styles.input}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="#9ca3af"
                  value={birthday}
                  onChangeText={setBirthday}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Gender</Text>
                <View style={styles.chipWrap}>
                  {GENDERS.map((g) => (
                    <TouchableOpacity
                      key={g.value}
                      style={[styles.chip, gender === g.value && styles.chipActive]}
                      onPress={() => setGender(gender === g.value ? "" : g.value)}
                    >
                      <Text style={[styles.chipText, gender === g.value && styles.chipTextActive]}>
                        {g.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </>
          )}

          {/* Relationship — guardian mode only */}
          {isGuardianMode && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>
                Relationship <Text style={styles.required}>*</Text>
              </Text>
              <View style={styles.chipWrap}>
                {RELATIONSHIPS.map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.chip, relationship === r && styles.chipActive]}
                    onPress={() => setRelationship(relationship === r ? "" : r)}
                  >
                    <Text style={[styles.chipText, relationship === r && styles.chipTextActive]}>
                      {r}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitButton, (!canSubmit || loading) && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.submitText}>Send invitation</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  headerTitle: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  headerSpacer: { minWidth: 60 },
  cancelText: { fontSize: 15, color: "#6b7280" },
  scrollContent: { padding: 20, gap: 20 },
  errorBox: { backgroundColor: "#fef2f2", borderRadius: 8, padding: 12 },
  errorText: { fontSize: 14, color: "#dc2626" },
  fieldGroup: { gap: 6 },
  nameRow: { flexDirection: "row", gap: 12 },
  label: { fontSize: 14, fontWeight: "500", color: "#374151" },
  required: { color: "#dc2626" },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#ffffff",
  },
  roleRow: { flexDirection: "row", gap: 8 },
  roleChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    alignItems: "center",
  },
  roleChipActive: { borderColor: "#0f172a", backgroundColor: "#0f172a" },
  roleChipText: { fontSize: 14, fontWeight: "500", color: "#374151" },
  roleChipTextActive: { color: "#ffffff" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  chipActive: { borderColor: "#0f172a", backgroundColor: "#0f172a" },
  chipText: { fontSize: 14, color: "#374151" },
  chipTextActive: { color: "#ffffff" },
  submitButton: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  submitButtonDisabled: { opacity: 0.4 },
  submitText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
  // Confirmation
  confirmCard: {
    backgroundColor: "#f9fafb",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  confirmTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  confirmBody: { fontSize: 14, color: "#6b7280", textAlign: "center" },
  bold: { fontWeight: "600", color: "#111827" },
  shareButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    marginTop: 4,
  },
  shareButtonText: { fontSize: 14, fontWeight: "500", color: "#374151" },
  confirmActions: { flexDirection: "row", gap: 12 },
  secondaryButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    alignItems: "center",
  },
  secondaryButtonText: { fontSize: 15, color: "#374151", fontWeight: "500" },
  primaryButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: "#0f172a",
    alignItems: "center",
  },
  primaryButtonText: { fontSize: 15, color: "#ffffff", fontWeight: "600" },
});
