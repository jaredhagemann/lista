import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { useSession } from "../../_layout";

type FeedbackType = "bug" | "feature";

const TYPES: { value: FeedbackType; label: string; icon: keyof typeof Ionicons.glyphMap; description: string }[] = [
  {
    value: "bug",
    label: "Bug Report",
    icon: "bug-outline",
    description: "Something isn't working as expected",
  },
  {
    value: "feature",
    label: "Feature Request",
    icon: "bulb-outline",
    description: "An idea for something new or improved",
  },
];

export default function FeedbackScreen() {
  const navigation = useNavigation();
  const session = useSession();

  const [type, setType] = useState<FeedbackType>("bug");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: "Send Feedback" });
  }, []);

  const canSubmit = description.trim().length >= 10;

  async function handleSubmit() {
    if (!canSubmit || !session?.user.id) return;
    setLoading(true);

    const { error } = await supabase.from("feedback").insert({
      user_id: session.user.id,
      type,
      description: description.trim(),
      app_version: "1.0.0",
    });

    setLoading(false);
    if (!error) setSubmitted(true);
  }

  if (submitted) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={56} color="#16a34a" />
          </View>
          <Text style={styles.successTitle}>Thanks for the feedback!</Text>
          <Text style={styles.successBody}>
            Your {type === "bug" ? "bug report" : "feature request"} has been
            received. We review all feedback and use it to improve Lista.
          </Text>
          <TouchableOpacity
            style={styles.doneButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Type selector */}
          <View style={styles.typeRow}>
            {TYPES.map((t) => {
              const active = type === t.value;
              return (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.typeCard, active && styles.typeCardActive]}
                  onPress={() => setType(t.value)}
                >
                  <Ionicons
                    name={t.icon}
                    size={22}
                    color={active ? "#0f172a" : "#9ca3af"}
                  />
                  <Text style={[styles.typeLabel, active && styles.typeLabelActive]}>
                    {t.label}
                  </Text>
                  <Text style={styles.typeDescription}>{t.description}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Description */}
          <View style={styles.card}>
            <Text style={styles.fieldLabel}>
              {type === "bug" ? "What happened?" : "What would you like to see?"}
            </Text>
            <TextInput
              style={styles.textArea}
              value={description}
              onChangeText={setDescription}
              placeholder={
                type === "bug"
                  ? "Describe the issue — what you were doing, what you expected, and what actually happened…"
                  : "Describe the feature — what problem it solves and how you'd like it to work…"
              }
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              maxLength={2000}
              autoFocus
            />
            <Text style={styles.charCount}>
              {description.trim().length < 10
                ? `${10 - description.trim().length} more characters needed`
                : `${description.trim().length} / 2000`}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.submitButton, (!canSubmit || loading) && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Send Feedback</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  scroll: { padding: 16, gap: 12 },

  typeRow: { flexDirection: "row", gap: 10 },
  typeCard: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    padding: 14,
    gap: 4,
    alignItems: "flex-start",
  },
  typeCardActive: {
    borderColor: "#0f172a",
    backgroundColor: "#f8fafc",
  },
  typeLabel: { fontSize: 14, fontWeight: "600", color: "#6b7280" },
  typeLabelActive: { color: "#0f172a" },
  typeDescription: { fontSize: 11, color: "#9ca3af", lineHeight: 15 },

  card: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    padding: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
    marginBottom: 10,
  },
  textArea: {
    fontSize: 15,
    color: "#111827",
    minHeight: 140,
    lineHeight: 22,
  },
  charCount: {
    fontSize: 11,
    color: "#9ca3af",
    marginTop: 8,
    textAlign: "right",
  },

  submitButton: {
    backgroundColor: "#0f172a",
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.4 },
  submitButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },

  successContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    gap: 12,
  },
  successIcon: { marginBottom: 8 },
  successTitle: { fontSize: 22, fontWeight: "700", color: "#111827", textAlign: "center" },
  successBody: { fontSize: 15, color: "#6b7280", textAlign: "center", lineHeight: 22 },
  doneButton: {
    marginTop: 16,
    backgroundColor: "#0f172a",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
  },
  doneButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
});
