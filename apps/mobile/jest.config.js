module.exports = {
  preset: "jest-expo",
  setupFiles: ["./jest.setup.js"],
  // jest-expo sets up correct pnpm-aware transformIgnorePatterns; extend it with
  // the NativeWind packages so `className` props are compiled in tests.
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|nativewind|react-native-css-interop))",
    "/node_modules/react-native-reanimated/plugin/",
  ],
};
