import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://lista.team";

type EligibleAdmin = {
  profileId: string;
  name: string;
  role: string;
};

type OwnedTeam = {
  id: string;
  name: string;
  eligibleAdmins: EligibleAdmin[];
};

export default function TeamSettingsScreen() {
  const navigation = useNavigation();

  const [teams, setTeams] = useState<OwnedTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Picker state
  const [pickerTeam, setPickerTeam] = useState<OwnedTeam | null>(null);
  const [transferring, setTransferring] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: "Team Settings" });
    loadOwnedTeams();
  }, []);

  async function getToken(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function loadOwnedTeams() {
    setLoading(true);
    setError(null);

    const token = await getToken();
    try {
      const res = await fetch(`${API_BASE}/api/account/owned-teams`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load teams");
      const json = await res.json();
      setTeams(json.teams ?? []);
    } catch {
      setError("Could not load your teams. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleTransfer(team: OwnedTeam, admin: EligibleAdmin) {
    setPickerTeam(null);
    setTransferring(true);

    const token = await getToken();
    try {
      const res = await fetch(`${API_BASE}/api/account/transfer-ownership`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ teamId: team.id, newOwnerProfileId: admin.profileId }),
      });

      if (res.ok) {
        Alert.alert(
          "Ownership Transferred",
          `${admin.name} is now the owner of ${team.name}.`,
          [{ text: "OK", onPress: loadOwnedTeams }]
        );
      } else {
        throw new Error("Transfer failed");
      }
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again or contact support@lista.team.");
    } finally {
      setTransferring(false);
    }
  }

  function confirmTransfer(team: OwnedTeam, admin: EligibleAdmin) {
    setPickerTeam(null);
    Alert.alert(
      "Transfer Ownership",
      `Transfer ownership of ${team.name} to ${admin.name}? You will retain your current role but will no longer have owner privileges.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Transfer",
          onPress: () => handleTransfer(team, admin),
        },
      ]
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <ActivityIndicator size="large" color="#0f172a" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadOwnedTeams}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (teams.length === 0) {
    return (
      <SafeAreaView style={styles.center} edges={["bottom"]}>
        <Text style={styles.emptyText}>You don't own any teams.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      {/* Admin picker modal */}
      <Modal
        visible={!!pickerTeam}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerTeam(null)}
      >
        <SafeAreaView style={styles.modal} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              Transfer ownership of {pickerTeam?.name}
            </Text>
            <TouchableOpacity onPress={() => setPickerTeam(null)}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSubtitle}>
            Select a coach or manager to become the new team owner.
          </Text>
          <FlatList
            data={pickerTeam?.eligibleAdmins ?? []}
            keyExtractor={(item) => item.profileId}
            contentContainerStyle={styles.modalList}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.adminRow}
                onPress={() => confirmTransfer(pickerTeam!, item)}
              >
                <View style={styles.adminRowText}>
                  <Text style={styles.adminName}>{item.name}</Text>
                  <Text style={styles.adminRole}>{item.role}</Text>
                </View>
                <Text style={styles.adminChevron}>›</Text>
              </TouchableOpacity>
            )}
          />
        </SafeAreaView>
      </Modal>

      {/* Full-screen loading overlay during transfer */}
      <Modal visible={transferring} transparent animationType="fade">
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.overlayText}>Transferring ownership…</Text>
        </View>
      </Modal>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.intro}>
          You own the following team{teams.length !== 1 ? "s" : ""}. Transfer
          ownership to another coach or manager before deleting your account.
        </Text>

        {teams.map((team) => (
          <View key={team.id} style={styles.teamCard}>
            <Text style={styles.teamName}>{team.name}</Text>
            {team.eligibleAdmins.length === 0 ? (
              <Text style={styles.noAdmins}>
                No eligible coaches or managers to transfer to. Add a coach or
                manager with an account to this team first.
              </Text>
            ) : (
              <TouchableOpacity
                style={styles.transferButton}
                onPress={() => setPickerTeam(team)}
              >
                <Text style={styles.transferButtonText}>Transfer Ownership</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  center: {
    flex: 1,
    backgroundColor: "#f9fafb",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  scroll: { padding: 16, gap: 12 },
  intro: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20,
    marginBottom: 4,
  },
  teamCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f3f4f6",
    padding: 16,
    gap: 12,
  },
  teamName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  noAdmins: {
    fontSize: 13,
    color: "#9ca3af",
    lineHeight: 18,
  },
  transferButton: {
    backgroundColor: "#0f172a",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  transferButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
  },
  errorText: {
    fontSize: 14,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    backgroundColor: "#0f172a",
    borderRadius: 10,
  },
  retryButtonText: { color: "#ffffff", fontWeight: "600", fontSize: 14 },
  emptyText: { fontSize: 14, color: "#9ca3af" },

  // Admin picker modal
  modal: { flex: 1, backgroundColor: "#f9fafb" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 16,
    paddingBottom: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    flex: 1,
    marginRight: 12,
  },
  modalCancel: { fontSize: 15, color: "#6b7280", paddingTop: 2 },
  modalSubtitle: {
    fontSize: 13,
    color: "#6b7280",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  modalList: { paddingHorizontal: 16 },
  adminRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  adminRowText: { flex: 1 },
  adminName: { fontSize: 15, fontWeight: "500", color: "#111827" },
  adminRole: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 2,
    textTransform: "capitalize",
  },
  adminChevron: { fontSize: 20, color: "#d1d5db", marginLeft: 8 },
  separator: { height: 1, backgroundColor: "#f3f4f6", marginVertical: 4 },

  // Transferring overlay
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  overlayText: { color: "#ffffff", fontSize: 16, fontWeight: "500" },
});
