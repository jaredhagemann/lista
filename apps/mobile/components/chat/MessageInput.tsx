import { useState, useRef } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export function MessageInput({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<TextInput>(null);

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  }

  return (
    <View style={styles.container}>
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Message…"
        placeholderTextColor="#9ca3af"
        multiline
        maxLength={4000}
        returnKeyType="default"
        blurOnSubmit={false}
      />
      <TouchableOpacity
        onPress={handleSend}
        disabled={!text.trim() || disabled}
        style={[
          styles.sendButton,
          (!text.trim() || disabled) && styles.sendButtonDisabled,
        ]}
      >
        <Ionicons
          name="arrow-up"
          size={18}
          color={text.trim() && !disabled ? "#ffffff" : "#9ca3af"}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    backgroundColor: "#ffffff",
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 8 : 6,
    fontSize: 15,
    color: "#111827",
    maxHeight: 120,
    backgroundColor: "#f9fafb",
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sendButtonDisabled: {
    backgroundColor: "#f3f4f6",
  },
});
