import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Link } from "expo-router";

export default function SignupScreen() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSignup() {
    setLoading(true);
    setError(null);

    const response = await fetch(
      `${process.env.EXPO_PUBLIC_API_URL}/api/auth/signup`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, firstName, lastName }),
      }
    );

    const result = await response.json();

    if (!response.ok) {
      setError(result.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);
  }

  if (success) {
    return (
      <View className="flex-1 bg-white justify-center px-6">
        <Text className="text-3xl font-bold text-center text-gray-900 mb-3">
          Check your email
        </Text>
        <Text className="text-gray-500 text-center mb-8">
          We sent a confirmation link to{" "}
          <Text className="font-medium text-gray-900">{email}</Text>. Click the
          link to activate your account.
        </Text>
        <Link href="/(auth)/login">
          <Text className="text-blue-600 text-center text-sm">
            Back to sign in
          </Text>
        </Link>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-3xl font-bold text-center text-gray-900 mb-1">
          Lista
        </Text>
        <Text className="text-gray-500 text-center mb-8">
          Create your account
        </Text>

        {error && (
          <View className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
            <Text className="text-red-600 text-sm">{error}</Text>
          </View>
        )}

        <View className="flex-row gap-3 mb-4">
          <View className="flex-1">
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              First name
            </Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-4 py-3.5 text-gray-900 text-base"
              placeholder="Jane"
              placeholderTextColor="#9ca3af"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              autoComplete="given-name"
            />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-medium text-gray-700 mb-1.5">
              Last name
            </Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-4 py-3.5 text-gray-900 text-base"
              placeholder="Smith"
              placeholderTextColor="#9ca3af"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              autoComplete="family-name"
            />
          </View>
        </View>

        <View className="mb-4">
          <Text className="text-sm font-medium text-gray-700 mb-1.5">
            Email
          </Text>
          <TextInput
            className="border border-gray-300 rounded-xl px-4 py-3.5 text-gray-900 text-base"
            placeholder="you@example.com"
            placeholderTextColor="#9ca3af"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
        </View>

        <View className="mb-4">
          <Text className="text-sm font-medium text-gray-700 mb-1.5">
            Password
          </Text>
          <TextInput
            className="border border-gray-300 rounded-xl px-4 py-3.5 text-gray-900 text-base"
            placeholder="At least 6 characters"
            placeholderTextColor="#9ca3af"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
          />
        </View>

        <TouchableOpacity
          className="bg-gray-900 rounded-xl py-4 items-center mt-2"
          onPress={handleSignup}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-white font-semibold text-base">
              Create account
            </Text>
          )}
        </TouchableOpacity>

        <Text className="text-gray-500 text-sm text-center mt-6">
          Already have an account?{" "}
          <Link href="/(auth)/login">
            <Text className="text-blue-600">Sign in</Text>
          </Link>
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
