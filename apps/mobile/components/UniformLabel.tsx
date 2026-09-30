import { Text, View } from "react-native";
import { PAGE_BACKGROUND, needsBorder, textColorOn, type Uniform } from "../lib/game-display";

/**
 * A game's uniform, by name: on a pill filled with its color when it has one,
 * as plain text when it doesn't, as the web's UniformLabel. A fill that would
 * vanish into the white card (white, pale colors) gets a thin border. Renders
 * nothing for a game with no uniform.
 */
export function UniformLabel({ uniform }: { uniform: Uniform | null }) {
  if (!uniform) return null;
  if (!uniform.color) {
    return (
      <Text accessibilityLabel={`Uniform: ${uniform.name}`} className="text-sm text-gray-700">
        {uniform.name}
      </Text>
    );
  }
  const bordered = needsBorder(uniform.color, PAGE_BACKGROUND);
  return (
    <View
      accessible
      accessibilityLabel={`Uniform: ${uniform.name}`}
      style={{
        alignSelf: "flex-start",
        // Never wider than where it's placed: a long name wraps inside the pill.
        maxWidth: "100%",
        backgroundColor: uniform.color,
        borderRadius: 99,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderWidth: bordered ? 1 : 0,
        borderColor: "#d1d5db",
      }}
    >
      <Text style={{ color: textColorOn(uniform.color), fontSize: 12, fontWeight: "600" }}>{uniform.name}</Text>
    </View>
  );
}
