import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppContext, type TeamMemberRow } from "../contexts/AppContext";

function teamInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

function TeamAvatar({
  name,
  logoUrl,
  size = 36,
}: {
  name: string;
  logoUrl: string | null;
  size?: number;
}) {
  if (logoUrl) {
    return (
      <Image
        source={{ uri: logoUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: "#0f172a",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontSize: size * 0.35, fontWeight: "700" }}>
        {teamInitials(name)}
      </Text>
    </View>
  );
}

export function SwitcherSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const {
    membership,
    activeProfile,
    ownProfile,
    allMemberships,
    managedProfiles,
    profilesOnActiveTeam,
    switching,
    switchTeam,
    switchProfile,
  } = useAppContext();

  // Deduplicate teams: one row per team_id, note how many profiles
  const uniqueTeams = new Map<
    string,
    { team: TeamMemberRow["teams"]; profileCount: number; role: string }
  >();
  for (const m of allMemberships) {
    if (uniqueTeams.has(m.team_id)) {
      uniqueTeams.get(m.team_id)!.profileCount++;
    } else {
      uniqueTeams.set(m.team_id, {
        team: m.teams,
        profileCount: 1,
        role: m.role,
      });
    }
  }
  const teamRows = Array.from(uniqueTeams.entries());

  const showProfileSection = profilesOnActiveTeam.length > 1;

  async function handleTeamPress(teamId: string) {
    await switchTeam(teamId);
    onClose();
  }

  async function handleProfilePress(profileId: string, teamId: string) {
    await switchProfile(profileId, teamId);
    onClose();
  }

  function relationshipLabel(profileId: string) {
    if (profileId === ownProfile?.id) return "you";
    const managed = managedProfiles.find((m) => m.managed_id === profileId);
    return managed?.relationship ?? "managed";
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* Backdrop — tap to close */}
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />

        {/* Sheet card */}
        <View style={styles.sheet}>
          {/* Handle bar */}
          <View style={styles.handle} />

          {switching ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#0f172a" />
              <Text style={styles.loadingText}>Switching…</Text>
            </View>
          ) : (
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.scrollContent}
            >
              {/* ── Teams ──────────────────────────────────────────────── */}
              <Text style={styles.sectionLabel}>Teams</Text>

              {teamRows.length === 0 ? (
                <Text style={styles.emptyText}>No teams yet.</Text>
              ) : (
                teamRows.map(([teamId, { team, profileCount, role }]) => {
                  const isActive = teamId === membership?.teamId;
                  return (
                    <TouchableOpacity
                      key={teamId}
                      style={[styles.row, isActive && styles.rowActive]}
                      onPress={() => handleTeamPress(teamId)}
                    >
                      <TeamAvatar name={team.name} logoUrl={team.logo_url} />
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {team.name}
                        </Text>
                        <Text style={styles.rowSub}>
                          {team.season
                            ? `${team.season} · `
                            : ""}
                          {profileCount > 1
                            ? `${profileCount} profiles`
                            : role}
                        </Text>
                      </View>
                      {isActive && (
                        <Ionicons
                          name="checkmark"
                          size={20}
                          color="#0f172a"
                        />
                      )}
                    </TouchableOpacity>
                  );
                })
              )}

              {/* ── View as ────────────────────────────────────────────── */}
              {showProfileSection && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.sectionLabel}>View as</Text>

                  {profilesOnActiveTeam.map((m) => {
                    const isActiveProfile =
                      m.profile_id === activeProfile?.id;
                    const label = relationshipLabel(m.profile_id);
                    const name = [
                      m.profiles.first_name,
                      m.profiles.last_name,
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <TouchableOpacity
                        key={m.profile_id}
                        style={[styles.row, isActiveProfile && styles.rowActive]}
                        onPress={() =>
                          handleProfilePress(m.profile_id, m.team_id)
                        }
                      >
                        {/* Profile initials avatar */}
                        <View style={styles.profileAvatar}>
                          <Text style={styles.profileAvatarText}>
                            {(m.profiles.first_name?.[0] ?? "") +
                              (m.profiles.last_name?.[0] ?? "")}
                          </Text>
                        </View>
                        <View style={styles.rowText}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {name}
                          </Text>
                          <Text style={styles.rowSub}>
                            {m.role} · {label}
                          </Text>
                        </View>
                        {isActiveProfile && (
                          <Ionicons
                            name="checkmark"
                            size={20}
                            color="#0f172a"
                          />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "75%",
    paddingBottom: 36,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: "#e5e7eb",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  loadingContainer: {
    paddingVertical: 48,
    alignItems: "center",
    gap: 12,
  },
  loadingText: {
    color: "#6b7280",
    fontSize: 14,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    color: "#9ca3af",
    paddingVertical: 8,
  },
  divider: {
    height: 1,
    backgroundColor: "#f3f4f6",
    marginVertical: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 12,
  },
  rowActive: {
    backgroundColor: "#f9fafb",
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  rowSub: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 1,
    textTransform: "capitalize",
  },
  profileAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#374151",
  },
});
