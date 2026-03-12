import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import { supabase } from "../../../lib/supabase";
import { useAppContext } from "../../../contexts/AppContext";
import { useSession } from "../../_layout";

const GENDER_OPTIONS = ["male", "female", "non-binary", "prefer not to say"];

export default function ProfileScreen() {
  const navigation = useNavigation();
  const session = useSession();
  const { ownProfile, refresh } = useAppContext();

  const [firstName, setFirstName] = useState(ownProfile?.first_name ?? "");
  const [lastName, setLastName] = useState(ownProfile?.last_name ?? "");
  const [birthday, setBirthday] = useState(ownProfile?.birthday ?? "");
  const [gender, setGender] = useState(ownProfile?.gender ?? "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: "Edit Profile" });
  }, []);

  async function handleSave() {
    if (!session?.user.id) return;
    setLoading(true);

    const { error } = await supabase
      .from("profiles")
      .update({
        first_name: firstName.trim(),
        last_name: lastName.trim() || null,
        birthday: birthday || null,
        gender: gender || null,
      })
      .eq("id", session.user.id);

    setLoading(false);

    if (error) {
      Alert.alert("Error", error.message);
    } else {
      await refresh();
      navigation.goBack();
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Field label="First name">
            <TextInput
              style={styles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor="#9ca3af"
              autoCapitalize="words"
              autoComplete="given-name"
            />
          </Field>
          <View style={styles.separator} />
          <Field label="Last name">
            <TextInput
              style={styles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              placeholderTextColor="#9ca3af"
              autoCapitalize="words"
              autoComplete="family-name"
            />
          </Field>
          <View style={styles.separator} />
          <Field label="Birthday">
            <TextInput
              style={styles.input}
              value={birthday}
              onChangeText={setBirthday}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#9ca3af"
              keyboardType="numbers-and-punctuation"
            />
          </Field>
          <View style={styles.separator} />
          <Field label="Gender">
            <View style={styles.genderOptions}>
              {GENDER_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => setGender(gender === opt ? "" : opt)}
                  style={[
                    styles.genderPill,
                    gender === opt && styles.genderPillActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.genderPillText,
                      gender === opt && styles.genderPillTextActive,
                    ]}
                  >
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, loading && { opacity: 0.6 }]}
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save changes</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  scroll: { padding: 16, gap: 12 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    overflow: "hidden",
  },
  field: { paddingHorizontal: 16, paddingVertical: 12 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { fontSize: 15, color: "#111827", paddingVertical: 0 },
  separator: { height: 1, backgroundColor: "#f9fafb", marginLeft: 16 },
  genderOptions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  genderPill: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  genderPillActive: { backgroundColor: "#0f172a", borderColor: "#0f172a" },
  genderPillText: { fontSize: 13, color: "#374151" },
  genderPillTextActive: { color: "#ffffff" },
  saveButton: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
  },
  saveButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
});
