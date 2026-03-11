import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  async function handleSubmit() {
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.EXPO_PUBLIC_API_URL}/auth/callback?next=/reset-password`,
    });

    if (error) {
      setError(error.message);
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
          We sent a password reset link to{" "}
          <Text className="font-medium text-gray-900">{email}</Text>. Click the
          link to reset your password.
        </Text>
        <TouchableOpacity onPress={() => router.replace("/(auth)/login")}>
          <Text className="text-blue-600 text-center text-sm">
            Back to sign in
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View className="flex-1 justify-center px-6">
        <TouchableOpacity className="mb-8" onPress={() => router.back()}>
          <Text className="text-blue-600 text-base">← Back</Text>
        </TouchableOpacity>

        <Text className="text-3xl font-bold text-gray-900 mb-1">
          Reset password
        </Text>
        <Text className="text-gray-500 mb-8">
          Enter your email and we&apos;ll send you a reset link
        </Text>

        {error && (
          <View className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
            <Text className="text-red-600 text-sm">{error}</Text>
          </View>
        )}

        <View className="mb-6">
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

        <TouchableOpacity
          className="bg-gray-900 rounded-xl py-4 items-center"
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-white font-semibold text-base">
              Send reset link
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
