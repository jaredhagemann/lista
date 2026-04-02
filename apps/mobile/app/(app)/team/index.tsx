import { useEffect, useState } from "react";
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../../lib/supabase";
import { useAppContext } from "../../../contexts/AppContext";

type Profile = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  avatar_url: string | null;
};

type Member = {
  id: string;
  profile_id: string;
  role: string;
  jersey_number: number | null;
  position: string | null;
  profiles: Profile;
};

type Invite = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
};

type Section = { title: string; data: (Member | Invite)[] };

function isMember(item: Member | Invite): item is Member {
  return "profile_id" in item;
}

const ROLE_ORDER: Record<string, number> = { coach: 0, manager: 1, parent: 2 };

function ProfileAvatar({
  avatarUrl,
  initials,
  size = 40,
}: {
  avatarUrl: string | null;
  initials: string;
  size?: number;
}) {
  if (avatarUrl) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View
      style={[
        styles.avatarInitials,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Text style={[styles.avatarInitialsText, { fontSize: size * 0.35 }]}>
        {initials}
      </Text>
    </View>
  );
}

export default function TeamScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { membership, loading: membershipLoading } = useAppContext();

  const [sections, setSections] = useState<Section[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin =
    membership?.role === "coach" || membership?.role === "manager";

  useEffect(() => {
    navigation.setOptions({ title: "Team" });
  }, []);

  async function fetchData() {
    if (!membership?.teamId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const [membersResult, invitesResult, teamResult] = await Promise.all([
      supabase
        .from("team_members")
        .select(
          "id, profile_id, role, jersey_number, position, profiles(id, first_name, last_name, email, avatar_url)"
        )
        .eq("team_id", membership.teamId),
      isAdmin
        ? supabase
            .from("invitations")
            .select("id, first_name, last_name, email, role")
            .eq("team_id", membership.teamId)
            .is("accepted_at", null)
            .is("managed_profile_id", null)
        : Promise.resolve({ data: [] }),
      supabase
        .from("teams")
        .select("owner_id")
        .eq("id", membership.teamId)
        .single(),
    ]);

    const members = (membersResult.data ?? []) as unknown as Member[];
    const invites = (invitesResult.data ?? []) as Invite[];
    setOwnerId(teamResult.data?.owner_id ?? null);

    // Players: sorted by jersey number (nulls last)
    const players = members
      .filter((m) => m.role === "player")
      .sort((a, b) => {
        if (a.jersey_number == null && b.jersey_number == null) return 0;
        if (a.jersey_number == null) return 1;
        if (b.jersey_number == null) return -1;
        return a.jersey_number - b.jersey_number;
      });

    const pendingPlayers = invites.filter((i) => i.role === "player");

    // Non-players: coaches first, then managers, then parents
    const nonPlayers = members
      .filter((m) => m.role !== "player")
      .sort(
        (a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)
      );

    const pendingNonPlayers = invites.filter((i) => i.role !== "player");

    setSections([
      { title: "Players", data: [...players, ...pendingPlayers] },
      { title: "Staff", data: [...nonPlayers, ...pendingNonPlayers] },
    ]);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => {
    if (membershipLoading) return;
    setLoading(true);
    fetchData();
  }, [membership?.teamId, membershipLoading]);

  function onRefresh() {
    setRefreshing(true);
    fetchData();
  }

  if (membershipLoading || loading) {
    return (
      <SafeAreaView
        style={styles.center}
        edges={["bottom"]}
      >
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => ("profile_id" in item ? item.id : `invite-${item.id}`)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        contentContainerStyle={{ paddingVertical: 8 }}
        stickySectionHeadersEnabled
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>No members yet.</Text>
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.data.length === 0 ? null : (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          if (isMember(item)) {
            const profile = item.profiles;
            const fullName = [profile.first_name, profile.last_name]
              .filter(Boolean)
              .join(" ");
            const initials = [profile.first_name, profile.last_name]
              .filter(Boolean)
              .map((n) => n[0])
              .join("")
              .toUpperCase();

            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => router.push(`/(app)/team/${item.id}` as any)}
              >
                <ProfileAvatar
                  avatarUrl={profile.avatar_url}
                  initials={initials}
                />
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {fullName}
                  </Text>
                  {item.role === "player" && (item.jersey_number != null || item.position) ? (
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {[
                        item.jersey_number != null ? `#${item.jersey_number}` : null,
                        item.position ?? null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  ) : null}
                </View>
                {ownerId && item.profile_id === ownerId ? (
                  <View style={styles.ownerBadge}>
                    <Text style={styles.ownerBadgeText}>Owner</Text>
                  </View>
                ) : (
                  <View style={styles.roleBadge}>
                    <Text style={styles.roleBadgeText} numberOfLines={1}>
                      {item.role}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          }

          // Pending invite row
          const fullName = [item.first_name, item.last_name]
            .filter(Boolean)
            .join(" ");
          const initials = [item.first_name, item.last_name]
            .filter(Boolean)
            .map((n) => n![0])
            .join("")
            .toUpperCase();

          return (
            <View style={[styles.row, styles.rowInvite]}>
              <ProfileAvatar avatarUrl={null} initials={initials || "?"} />
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {fullName || item.email}
                </Text>
                {fullName ? (
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {item.email}
                  </Text>
                ) : null}
              </View>
              <View style={styles.invitedBadge}>
                <Ionicons name="time-outline" size={11} color="#6b7280" />
                <Text style={styles.invitedBadgeText}>Invited</Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  center: { flex: 1, backgroundColor: "#ffffff", justifyContent: "center", alignItems: "center" },
  empty: { flex: 1, alignItems: "center", paddingTop: 64, gap: 8 },
  emptyText: { color: "#9ca3af", fontSize: 15 },
  sectionHeader: {
    backgroundColor: "#f9fafb",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  sectionHeaderText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    marginHorizontal: 12,
    marginVertical: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: "#f3f4f6",
  },
  rowInvite: {
    borderStyle: "dashed",
    borderColor: "#e5e7eb",
  },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: "600", color: "#111827" },
  jersey: { color: "#9ca3af", fontWeight: "400" },
  rowSub: { fontSize: 12, color: "#9ca3af", marginTop: 1 },
  roleBadge: {
    backgroundColor: "#f3f4f6",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#374151",
    textTransform: "capitalize",
  },
  ownerBadge: {
    borderWidth: 1,
    borderColor: "#fbbf24",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  ownerBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#d97706",
    textTransform: "capitalize",
  },
  invitedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  invitedBadgeText: { fontSize: 11, color: "#6b7280" },
  avatarInitials: {
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitialsText: { fontWeight: "700", color: "#374151" },
});
