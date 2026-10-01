/**
 * BUG-031: in the app's chat, the keyboard covered the message box and Send.
 *
 * Both chat screens used a KeyboardAvoidingView with keyboardVerticalOffset 0.
 * That only works for a view at the top of the screen; the chat view sits below
 * the safe area, the team strip and the chat header (~140-155 pt), so the
 * padding fell short by that much and hid the box. KeyboardScreen measures where
 * it sits on screen and passes that as the offset.
 *
 * Jest can't show a keyboard, so this pins the contract: the measured top is
 * the offset, and both chat screens use it. The on-device check is in
 * docs/releases/mobile-next.md.
 */

import React from "react";
import { KeyboardAvoidingView, Text, View } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { KeyboardScreen } from "../components/KeyboardScreen";

const fs = require("fs") as { readFileSync(path: string, encoding: "utf8"): string };
const path = require("path") as { join(...parts: string[]): string };
declare const __dirname: string;

function layout() {
  fireEvent(screen.getByTestId("keyboard-screen"), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 600 } },
  });
}

describe("KeyboardScreen", () => {
  afterEach(() => jest.restoreAllMocks());

  it("offsets the keyboard by how far down the screen it sits", () => {
    jest
      .spyOn(View.prototype as unknown as { measureInWindow: (cb: (...n: number[]) => void) => void }, "measureInWindow")
      .mockImplementation((cb) => cb(0, 151, 390, 600));
    render(
      <KeyboardScreen>
        <Text>messages</Text>
      </KeyboardScreen>
    );

    layout();

    expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.keyboardVerticalOffset).toBe(151);
    expect(screen.getByText("messages")).toBeTruthy();
  });

  it("starts at 0 until it has been measured", () => {
    render(
      <KeyboardScreen>
        <Text>messages</Text>
      </KeyboardScreen>
    );

    expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.keyboardVerticalOffset).toBe(0);
  });
});

describe("the chat screens", () => {
  const screens = ["app/(app)/chat/[channelId].tsx", "app/(app)/chat/dm/[dmId].tsx"].map((file) => ({
    file,
    text: fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
  }));

  it.each(screens.map((s) => [s.file, s.text]))("%s keeps its input above the keyboard with KeyboardScreen", (_file, text) => {
    expect(text).toContain("<KeyboardScreen");
    expect(text).not.toContain("<KeyboardAvoidingView");
    expect(text).not.toMatch(/keyboardVerticalOffset=\{0\}/);
  });
});
