/**
 * Jest global setup — runs after jest-expo's react-native mock is installed.
 *
 * jest-expo mocks react-native correctly (no native module access), but
 * Modal may be undefined in test environments where the native Modal bridge
 * isn't set up. Provide a minimal implementation that renders children
 * when visible=true so SwitcherSheet tests can assert on rendered content.
 */
const React = require("react");
const ReactNative = require("react-native");

if (!ReactNative.Modal || typeof ReactNative.Modal !== "function") {
  ReactNative.Modal = function Modal({ visible, children }) {
    return visible ? children : null;
  };
}
