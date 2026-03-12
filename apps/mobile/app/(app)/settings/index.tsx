import { View, Text, TouchableOpacity, Image, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { supabase } from "../../../lib/supabase";
import { useAppContext } from "../../../contexts/AppContext";

function NavRow({
  icon,
  label,
  sublabel,
  onPress,
  destructive,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={[styles.rowIcon, destructive && styles.rowIconDestructive]}>
        <Ionicons name={icon} size={18} color={destructive ? "#dc2626" : "#374151"} />
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, destructive && styles.rowLabelDestructive]}>
          {label}
        </Text>
        {sublabel ? <Text style={styles.rowSublabel}>{sublabel}</Text> : null}
      </View>
      {!destructive && (
        <Ionicons name="chevron-forward" size={16} color="#d1d5db" />
      )}
    </TouchableOpacity>
  );
}

export default function SettingsHubScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { ownProfile, managedProfiles, membership } = useAppContext();

  useEffect(() => {
    navigation.setOptions({ title: "Settings" });
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/(auth)/login");
  }

  const fullName = [ownProfile?.first_name, ownProfile?.last_name]
    .filter(Boolean)
    .join(" ");

  const initials = (
    (ownProfile?.first_name?.[0] ?? "") + (ownProfile?.last_name?.[0] ?? "")
  ).toUpperCase();

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Profile card */}
        <View style={styles.profileCard}>
          {ownProfile?.avatar_url ? (
            <Image source={{ uri: ownProfile.avatar_url }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarFallbackText}>{initials}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{fullName || "—"}</Text>
            {ownProfile?.email ? (
              <Text style={styles.profileEmail}>{ownProfile.email}</Text>
            ) : null}
            {membership ? (
              <Text style={styles.profileRole}>{membership.role} · {membership.teamName}</Text>
            ) : null}
          </View>
        </View>

        {/* Account section */}
        <Text style={styles.sectionLabel}>Account</Text>
        <View style={styles.card}>
          <NavRow
            icon="person-outline"
            label="Edit Profile"
            sublabel="Name, birthday, gender"
            onPress={() => router.push("/(app)/settings/profile" as any)}
          />
          <View style={styles.separator} />
          <NavRow
            icon="notifications-outline"
            label="Notifications"
            sublabel="Email and push preferences"
            onPress={() => router.push("/(app)/settings/notifications" as any)}
          />
          <View style={styles.separator} />
          <NavRow
            icon="people-outline"
            label="Managed Players"
            sublabel={
              managedProfiles.length > 0
                ? `${managedProfiles.length} player${managedProfiles.length !== 1 ? "s" : ""}`
                : "Add a player you manage"
            }
            onPress={() => router.push("/(app)/settings/managed-players" as any)}
          />
        </View>

        {/* Feedback */}
        <View style={[styles.card, { marginTop: 8 }]}>
          <NavRow
            icon="chatbubble-ellipses-outline"
            label="Send Feedback"
            sublabel="Report a bug or request a feature"
            onPress={() => router.push("/(app)/settings/feedback" as any)}
          />
        </View>

        {/* Sign out */}
        <View style={[styles.card, { marginTop: 8 }]}>
          <NavRow
            icon="log-out-outline"
            label="Sign Out"
            onPress={handleSignOut}
            destructive
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  scroll: { padding: 16, gap: 8 },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    padding: 16,
    gap: 14,
    marginBottom: 8,
  },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: { fontSize: 20, fontWeight: "700", color: "#374151" },
  profileName: { fontSize: 17, fontWeight: "700", color: "#111827" },
  profileEmail: { fontSize: 13, color: "#6b7280", marginTop: 1 },
  profileRole: { fontSize: 12, color: "#9ca3af", marginTop: 2, textTransform: "capitalize" },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
    marginLeft: 4,
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },
  rowIconDestructive: { backgroundColor: "#fef2f2" },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "500", color: "#111827" },
  rowLabelDestructive: { color: "#dc2626" },
  rowSublabel: { fontSize: 12, color: "#9ca3af", marginTop: 1 },
  separator: { height: 1, backgroundColor: "#f9fafb", marginLeft: 60 },
});
