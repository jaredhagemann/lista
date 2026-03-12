import { View, Text, StyleSheet, TouchableOpacity, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export type Message = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  profiles: { first_name: string; last_name: string } | null;
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(profile: { first_name: string; last_name: string } | null) {
  if (!profile) return "?";
  return (
    (profile.first_name?.[0] ?? "") + (profile.last_name?.[0] ?? "")
  ).toUpperCase();
}

function senderName(profile: { first_name: string; last_name: string } | null) {
  if (!profile) return "Unknown";
  return [profile.first_name, profile.last_name].filter(Boolean).join(" ");
}

export function MessageItem({
  message,
  isOwn,
  showSender,
  canDelete,
  onDelete,
}: {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  const deleted = !!message.deleted_at;

  function handleLongPress() {
    if (!canDelete || deleted) return;
    Alert.alert("Delete message", "Remove this message for everyone?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => onDelete(message.id),
      },
    ]);
  }

  return (
    <TouchableOpacity
      activeOpacity={canDelete && !deleted ? 0.7 : 1}
      onLongPress={handleLongPress}
      style={[styles.row, isOwn && styles.rowOwn]}
    >
      {/* Avatar — shown for others, spacer for own */}
      {!isOwn ? (
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(message.profiles)}</Text>
        </View>
      ) : (
        <View style={styles.avatarSpacer} />
      )}

      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        {showSender && !isOwn && (
          <Text style={styles.senderName}>{senderName(message.profiles)}</Text>
        )}
        {deleted ? (
          <View style={styles.deletedRow}>
            <Ionicons name="ban-outline" size={13} color="#9ca3af" />
            <Text style={styles.deletedText}>Message deleted</Text>
          </View>
        ) : (
          <Text style={[styles.body, isOwn && styles.bodyOwn]}>
            {message.body}
          </Text>
        )}
        <Text style={[styles.time, isOwn && styles.timeOwn]}>
          {formatTime(message.created_at)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginHorizontal: 12,
    marginVertical: 2,
    gap: 8,
  },
  rowOwn: {
    flexDirection: "row-reverse",
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: { fontSize: 10, fontWeight: "700", color: "#374151" },
  avatarSpacer: { width: 28, flexShrink: 0 },
  bubble: {
    maxWidth: "75%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    gap: 2,
  },
  bubbleOther: {
    backgroundColor: "#f3f4f6",
    borderBottomLeftRadius: 4,
  },
  bubbleOwn: {
    backgroundColor: "#0f172a",
    borderBottomRightRadius: 4,
  },
  senderName: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6b7280",
    marginBottom: 2,
  },
  body: { fontSize: 15, color: "#111827", lineHeight: 20 },
  bodyOwn: { color: "#ffffff" },
  deletedRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  deletedText: { fontSize: 13, color: "#9ca3af", fontStyle: "italic" },
  time: { fontSize: 10, color: "#9ca3af", alignSelf: "flex-end" },
  timeOwn: { color: "rgba(255,255,255,0.5)" },
});
