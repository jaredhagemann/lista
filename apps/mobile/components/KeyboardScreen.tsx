import { useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, View, type StyleProp, type ViewStyle } from "react-native";

/**
 * A screen's content that stays above the keyboard (BUG-031).
 *
 * KeyboardAvoidingView pads by how far the keyboard overlaps it, but it assumes
 * it starts at the top of the screen unless `keyboardVerticalOffset` says how
 * far down it really is. Screens inside the app sit below the safe area, the
 * team strip and a header, so a fixed 0 left the chat's message box under the
 * keyboard. This measures where it sits on screen and uses that, so it stays
 * right whatever is above it (a taller strip, large text, another header).
 */
export function KeyboardScreen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<View>(null);
  const [top, setTop] = useState(0);

  return (
    <View
      ref={ref}
      testID="keyboard-screen"
      style={{ flex: 1 }}
      onLayout={() => ref.current?.measureInWindow((_x, y) => setTop(y))}
    >
      <KeyboardAvoidingView
        style={[{ flex: 1 }, style]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={top}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
