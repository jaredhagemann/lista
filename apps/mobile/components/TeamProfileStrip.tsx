import { useState } from "react";
import { View, Text, TouchableOpacity, Image, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppContext } from "../contexts/AppContext";
import { SwitcherSheet } from "./SwitcherSheet";

function teamInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function TeamProfileStrip() {
  const { membership, ownProfile, activeProfile, loading, switching } =
    useAppContext();
  const [sheetOpen, setSheetOpen] = useState(false);

  const isViewingManaged =
    activeProfile !== null && activeProfile?.id !== ownProfile?.id;

  return (
    <>
      <TouchableOpacity
        onPress={() => setSheetOpen(true)}
        activeOpacity={0.7}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 10,
          backgroundColor: "#ffffff",
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: "#e5e7eb",
          gap: 10,
        }}
      >
        {/* Team avatar */}
        {loading ? (
          <View style={styles.avatarPlaceholder} />
        ) : membership?.logoUrl ? (
          <Image
            source={{ uri: membership.logoUrl }}
            style={styles.avatar}
          />
        ) : (
          <View style={styles.avatarInitials}>
            <Text style={styles.avatarInitialsText}>
              {membership ? teamInitials(membership.teamName) : "—"}
            </Text>
          </View>
        )}

        {/* Team name + viewing-as */}
        <View style={{ flex: 1 }}>
          {loading ? (
            <View style={styles.skeletonTitle} />
          ) : (
            <Text style={styles.teamName} numberOfLines={1}>
              {membership?.teamName ?? "No team"}
            </Text>
          )}
          {!loading && isViewingManaged ? (
            <Text style={styles.viewingAs}>
              Viewing as: {activeProfile?.first_name}
            </Text>
          ) : null}
        </View>

        {/* Trailing indicator */}
        {switching ? (
          <ActivityIndicator size="small" color="#9ca3af" />
        ) : (
          <Ionicons name="chevron-down" size={18} color="#9ca3af" />
        )}
      </TouchableOpacity>

      <SwitcherSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}

import { StyleSheet } from "react-native";

const styles = StyleSheet.create({
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarInitials: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitialsText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#f3f4f6",
  },
  teamName: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0f172a",
  },
  viewingAs: {
    fontSize: 11,
    color: "#d97706",
    marginTop: 1,
  },
  skeletonTitle: {
    height: 14,
    width: 140,
    borderRadius: 4,
    backgroundColor: "#f3f4f6",
  },
});
