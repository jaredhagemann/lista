import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { useAppContext } from "../../../contexts/AppContext";
import { useSession } from "../../_layout";

type ManagedPlayer = {
  id: string;
  first_name: string;
  last_name: string | null;
  birthday: string | null;
  relationship: string | null;
};

export default function ManagedPlayersScreen() {
  const navigation = useNavigation();
  const session = useSession();
  const { managedProfiles, refresh } = useAppContext();

  const [players, setPlayers] = useState<ManagedPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    birthday: "",
    relationship: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: "Managed Players" });
  }, []);

  useEffect(() => {
    // Build list from context (already fetched)
    const list: ManagedPlayer[] = managedProfiles.map((mp) => ({
      id: mp.managed_id,
      first_name: mp.profiles.first_name,
      last_name: mp.profiles.last_name,
      birthday: (mp.profiles as any).birthday ?? null,
      relationship: mp.relationship,
    }));
    setPlayers(list);
    setLoading(false);
  }, [managedProfiles]);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleAdd() {
    if (!form.firstName.trim()) {
      Alert.alert("Required", "First name is required.");
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) return;

    setSaving(true);
    const response = await fetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/managed-profiles`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || undefined,
          birthday: form.birthday.trim() || undefined,
          relationship: form.relationship.trim() || undefined,
        }),
      }
    );

    const result = await response.json();
    setSaving(false);

    if (!response.ok) {
      Alert.alert("Error", result.error ?? "Something went wrong.");
      return;
    }

    // Refresh context so the new player appears everywhere
    await refresh();
    setForm({ firstName: "", lastName: "", birthday: "", relationship: "" });
    setShowForm(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.description}>
          Manage player profiles on behalf of others — typically your children.
          You can switch to their view using the team selector at the top of the app.
        </Text>

        {/* Existing players */}
        {players.length > 0 && (
          <View style={styles.card}>
            {players.map((p, i) => {
              const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
              const initials = (
                (p.first_name?.[0] ?? "") + (p.last_name?.[0] ?? "")
              ).toUpperCase();
              return (
                <View key={p.id}>
                  {i > 0 && <View style={styles.separator} />}
                  <View style={styles.playerRow}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.playerName}>{name}</Text>
                      {p.relationship ? (
                        <Text style={styles.playerSub}>{p.relationship}</Text>
                      ) : null}
                      {p.birthday ? (
                        <Text style={styles.playerSub}>Born {p.birthday}</Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Add player form */}
        {showForm ? (
          <View style={styles.card}>
            <Text style={styles.formTitle}>Add a player</Text>
            <FormField label="First name *">
              <TextInput
                style={styles.input}
                value={form.firstName}
                onChangeText={(v) => set("firstName", v)}
                placeholder="First name"
                placeholderTextColor="#9ca3af"
                autoCapitalize="words"
                autoFocus
              />
            </FormField>
            <View style={styles.separator} />
            <FormField label="Last name">
              <TextInput
                style={styles.input}
                value={form.lastName}
                onChangeText={(v) => set("lastName", v)}
                placeholder="Last name"
                placeholderTextColor="#9ca3af"
                autoCapitalize="words"
              />
            </FormField>
            <View style={styles.separator} />
            <FormField label="Relationship">
              <TextInput
                style={styles.input}
                value={form.relationship}
                onChangeText={(v) => set("relationship", v)}
                placeholder="e.g. Son, Daughter"
                placeholderTextColor="#9ca3af"
                autoCapitalize="words"
              />
            </FormField>
            <View style={styles.separator} />
            <FormField label="Birthday">
              <TextInput
                style={styles.input}
                value={form.birthday}
                onChangeText={(v) => set("birthday", v)}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#9ca3af"
                keyboardType="numbers-and-punctuation"
              />
            </FormField>

            <View style={styles.formActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => { setShowForm(false); setForm({ firstName: "", lastName: "", birthday: "", relationship: "" }); }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addButton, saving && { opacity: 0.6 }]}
                onPress={handleAdd}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.addButtonText}>Add player</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.addRowButton}
            onPress={() => setShowForm(true)}
          >
            <Ionicons name="add-circle-outline" size={20} color="#0f172a" />
            <Text style={styles.addRowButtonText}>Add a player</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  center: { flex: 1, backgroundColor: "#fff", justifyContent: "center", alignItems: "center" },
  scroll: { padding: 16, gap: 12 },
  description: { fontSize: 13, color: "#6b7280", lineHeight: 18 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    overflow: "hidden",
  },
  playerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 13, fontWeight: "700", color: "#374151" },
  playerName: { fontSize: 15, fontWeight: "600", color: "#111827" },
  playerSub: { fontSize: 12, color: "#9ca3af", marginTop: 1, textTransform: "capitalize" },
  separator: { height: 1, backgroundColor: "#f9fafb", marginLeft: 16 },
  formTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  field: { paddingHorizontal: 16, paddingVertical: 12 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: { fontSize: 15, color: "#111827" },
  formActions: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#f9fafb",
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  cancelButtonText: { fontSize: 15, color: "#374151", fontWeight: "500" },
  addButton: {
    flex: 1,
    backgroundColor: "#0f172a",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  addButtonText: { fontSize: 15, color: "#ffffff", fontWeight: "600" },
  addRowButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  addRowButtonText: { fontSize: 15, fontWeight: "500", color: "#0f172a" },
});
