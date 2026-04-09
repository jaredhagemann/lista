import { useState } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { supabase } from "../../lib/supabase";
import { useAppContext } from "../../contexts/AppContext";
import { executeCreateTeamMobile } from "../../lib/create-team";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://lista.team";

export default function CreateTeamScreen() {
  const router = useRouter();
  const { refresh } = useAppContext();

  const [teamName, setTeamName] = useState("");
  const [season, setSeason] = useState("");
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = teamName.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);

    const err = await executeCreateTeamMobile(
      { teamName, season, orgName },
      {
        getAccessToken: async () => {
          const { data } = await supabase.auth.getSession();
          return data.session?.access_token ?? null;
        },
        deleteSecureStoreKey: SecureStore.deleteItemAsync,
        refresh,
        routerReplace: (path) => router.replace(path as Parameters<typeof router.replace>[0]),
      },
      API_BASE
    );

    if (err) {
      setError(err);
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create a Team</Text>
          <View style={styles.cancelButton} />
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

          {/* Team name (required) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>
              Team name <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. U12 Boys Blue"
              placeholderTextColor="#9ca3af"
              value={teamName}
              onChangeText={setTeamName}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>

          {/* Season (optional) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Season</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Spring 2026"
              placeholderTextColor="#9ca3af"
              value={season}
              onChangeText={setSeason}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>

          {/* Club / org name (optional) */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Club / organization name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Westside FC"
              placeholderTextColor="#9ca3af"
              value={orgName}
              onChangeText={setOrgName}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
          </View>

          <TouchableOpacity
            style={[styles.submitButton, (!canSubmit || loading) && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.submitText}>
                {loading ? "Creating..." : "Create team"}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  cancelButton: {
    minWidth: 60,
  },
  cancelText: {
    fontSize: 15,
    color: "#6b7280",
  },
  scrollContent: {
    padding: 20,
    gap: 20,
  },
  errorBox: {
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    color: "#dc2626",
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
  },
  required: {
    color: "#dc2626",
  },
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
  submitButton: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
