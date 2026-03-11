import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function TeamScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 justify-center items-center">
        <Text className="text-2xl font-bold text-gray-900">Team</Text>
        <Text className="text-gray-500 mt-2">Roster coming soon</Text>
      </View>
    </SafeAreaView>
  );
}
