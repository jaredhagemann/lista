module.exports = function (api) {
  // api.env() is self-caching; using api.cache(true) alongside it causes a conflict.
  api.cache.invalidate(() => process.env.NODE_ENV);
  // NativeWind's JSX runtime crashes in Jest because react-native-css-interop's
  // runtime expects native APIs that don't exist in the test environment.
  // Disable nativewind transforms for tests — className props are simply ignored,
  // but component text content and touchable areas still render correctly.
  const isTest = api.env("test");
  return {
    presets: [
      ["babel-preset-expo", isTest ? {} : { jsxImportSource: "nativewind" }],
      ...(isTest ? [] : ["nativewind/babel"]),
    ],
  };
};
