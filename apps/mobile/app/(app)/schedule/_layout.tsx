import { Stack } from "expo-router";

export default function ScheduleLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackTitle: "Back",
        headerTintColor: "#0f172a",
        headerStyle: { backgroundColor: "#ffffff" },
        headerShadowVisible: false,
      }}
    />
  );
}
