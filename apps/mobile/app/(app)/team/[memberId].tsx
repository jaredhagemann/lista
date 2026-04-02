import { useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { useAppContext } from "../../../contexts/AppContext";

type Profile = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  avatar_url: string | null;
  birthday: string | null;
  gender: string | null;
};

type Member = {
  id: string;
  profile_id: string;
  team_id: string;
  role: string;
  jersey_number: number | null;
  position: string | null;
  profiles: Profile;
};

type Manager = {
  manager_id: string;
  relationship: string;
  profiles: { first_name: string; last_name: string; email: string | null };
};

function formatBirthday(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function MemberDetailScreen() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();
  const navigation = useNavigation();
  const { membership, activeProfile } = useAppContext();

  const [member, setMember] = useState<Member | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData() {
    if (!memberId) return;

    const { data: memberData } = await supabase
      .from("team_members")
      .select(
        "id, profile_id, team_id, role, jersey_number, position, profiles(id, first_name, last_name, email, avatar_url, birthday, gender)"
      )
      .eq("id", memberId)
      .single();

    if (!memberData) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const m = memberData as unknown as Member;
    setMember(m);
    navigation.setOptions({
      title: [m.profiles.first_name, m.profiles.last_name]
        .filter(Boolean)
        .join(" "),
    });

    // Fetch managers for this profile (visible to teammates via RLS)
    const { data: managersData } = await supabase
      .from("profile_managers")
      .select(
        "manager_id, relationship, profiles!profile_managers_manager_id_fkey(first_name, last_name, email)"
      )
      .eq("managed_id", m.profile_id);

    setManagers((managersData ?? []) as unknown as Manager[]);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    fetchData();
  }, [memberId]);

  function onRefresh() {
    setRefreshing(true);
    fetchData();
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  if (!member) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <Text style={styles.notFound}>Member not found.</Text>
      </SafeAreaView>
    );
  }

  const profile = member.profiles;
  const fullName = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(" ");
  const initials = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  const isAdmin =
    membership?.role === "coach" || membership?.role === "manager";
  const isOwnProfile = profile.id === activeProfile?.id;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={styles.scrollContent}
      >
        {/* Avatar + name header */}
        <View style={styles.header}>
          {profile.avatar_url ? (
            <Image
              source={{ uri: profile.avatar_url }}
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarFallbackText}>{initials}</Text>
            </View>
          )}
          <Text style={styles.name}>{fullName}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{member.role}</Text>
          </View>
        </View>

        {/* Profile details */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Profile</Text>
          {profile.birthday ? (
            <InfoRow label="Birthday" value={formatBirthday(profile.birthday)} />
          ) : null}
          {profile.gender ? (
            <InfoRow
              label="Gender"
              value={
                profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1)
              }
            />
          ) : null}
          <InfoRow label="Role" value={member.role.charAt(0).toUpperCase() + member.role.slice(1)} />
          {member.role === "player" && member.jersey_number != null ? (
            <InfoRow label="Jersey" value={`#${member.jersey_number}`} />
          ) : null}
          {member.role === "player" && member.position ? (
            <InfoRow label="Position" value={member.position} />
          ) : null}
        </View>

        {/* Managers section — only shown when relevant */}
        {managers.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Managed by</Text>
            {managers.map((mgr) => {
              const mgrName = [
                mgr.profiles.first_name,
                mgr.profiles.last_name,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <View key={mgr.manager_id} style={styles.managerRow}>
                  <View style={styles.managerAvatar}>
                    <Text style={styles.managerAvatarText}>
                      {(mgr.profiles.first_name?.[0] ?? "") +
                        (mgr.profiles.last_name?.[0] ?? "")}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.managerName}>{mgrName}</Text>
                    <Text style={styles.managerRelationship}>
                      {mgr.relationship}
                    </Text>
                    {mgr.profiles.email ? (
                      <Text style={styles.managerEmail}>{mgr.profiles.email}</Text>
                    ) : null}
                  </View>
                  <Ionicons name="people-outline" size={16} color="#9ca3af" />
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  center: {
    flex: 1,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    alignItems: "center",
  },
  notFound: { color: "#9ca3af", fontSize: 15 },
  scrollContent: { padding: 16, gap: 12 },
  header: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  avatarFallback: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: { fontSize: 28, fontWeight: "700", color: "#374151" },
  name: { fontSize: 22, fontWeight: "700", color: "#111827" },
  roleBadge: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  roleBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
    textTransform: "capitalize",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    padding: 16,
    gap: 2,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f9fafb",
  },
  infoLabel: { fontSize: 14, color: "#6b7280" },
  infoValue: { fontSize: 14, color: "#111827", fontWeight: "500" },
  managerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f9fafb",
  },
  managerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  managerAvatarText: { fontSize: 12, fontWeight: "700", color: "#374151" },
  managerName: { fontSize: 14, fontWeight: "600", color: "#111827" },
  managerRelationship: { fontSize: 12, color: "#9ca3af", textTransform: "capitalize" },
  managerEmail: { fontSize: 12, color: "#6b7280", marginTop: 1 },
});
