import { View } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppProvider } from "../../contexts/AppContext";
import { TeamProfileStrip } from "../../components/TeamProfileStrip";

export default function AppLayout() {
  return (
    <AppProvider>
      <SafeAreaView edges={["top"]} style={{ flex: 1, backgroundColor: "#ffffff" }}>
        <TeamProfileStrip />
        <View style={{ flex: 1 }}>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarActiveTintColor: "#0f172a",
              tabBarInactiveTintColor: "#9ca3af",
              tabBarStyle: {
                borderTopColor: "#e5e7eb",
              },
            }}
          >
            <Tabs.Screen
              name="index"
              options={{
                title: "Home",
                tabBarIcon: ({ color, size }) => (
                  <Ionicons name="home-outline" size={size} color={color} />
                ),
              }}
            />
            <Tabs.Screen
              name="schedule"
              options={{
                title: "Schedule",
                tabBarIcon: ({ color, size }) => (
                  <Ionicons name="calendar-outline" size={size} color={color} />
                ),
              }}
            />
            <Tabs.Screen
              name="team"
              options={{
                title: "Team",
                tabBarIcon: ({ color, size }) => (
                  <Ionicons name="people-outline" size={size} color={color} />
                ),
              }}
            />
            <Tabs.Screen
              name="chat"
              options={{
                title: "Chat",
                tabBarIcon: ({ color, size }) => (
                  <Ionicons name="chatbubble-outline" size={size} color={color} />
                ),
              }}
            />
            <Tabs.Screen
              name="settings"
              options={{
                title: "Settings",
                tabBarIcon: ({ color, size }) => (
                  <Ionicons name="settings-outline" size={size} color={color} />
                ),
              }}
            />
            <Tabs.Screen
              name="create-team"
              options={{
                tabBarButton: () => null,
                title: "Create a Team",
              }}
            />
          </Tabs>
        </View>
      </SafeAreaView>
    </AppProvider>
  );
}
