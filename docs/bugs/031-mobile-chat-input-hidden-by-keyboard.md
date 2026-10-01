# BUG-031 — In the app's chat, the keyboard covers the message box and Send button

**Severity:** P1. Chat from the phone is unusable: you can't see what you type, or send it. The workaround is
the web.
**Status:** Open
**Reported:** 2026-09-30 by the user, testing TestFlight 1.1.0 (build 18) on an iPhone
**Area:** ios, chat
**Evidence class:** Mixed. The symptom is reproduced on a device (TestFlight build 18, production). The cause
is static, from code inspection.
**Last verified:** `d78608a58` (the build's commit), iPhone. The cause is from reading the code on `main`.

## Symptom

In the Chat tab, open a team channel or a direct message and tap the message box. The keyboard comes up, but
the box and its Send button don't move up enough: they stay behind the keyboard. You can't see what you're
typing, and you can't send.

## Reproduction

1. In the app on an iPhone, open Chat and then any channel or direct message.
2. Tap the message box.

**Expected:** the message box and Send button sit just above the keyboard, and the latest messages are
visible above them.
**Actual:** the box and the Send button are covered by the keyboard.

**Probably on the installed 1.0.12 too:** the chat screens, the top strip and the chat navigation haven't
changed the layout since April. #102 kept the strip's height. That's inferred, not checked on 1.0.12.

**Not checked:** Android.

## Evidence

- **Both chat screens** wrap the messages and the input in a `KeyboardAvoidingView` with no offset:
  - `apps/mobile/app/(app)/chat/[channelId].tsx:169-173`
  - `apps/mobile/app/(app)/chat/dm/[dmId].tsx:177-181`

  ```tsx
  <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
  ```

- **What sits above that view**, top to bottom:
  1. the top safe-area inset (`apps/mobile/app/(app)/_layout.tsx`, `SafeAreaView edges={["top"]}`), about
     47–59 pt on a modern iPhone
  2. the team strip (`components/TeamProfileStrip.tsx`, a 32 pt logo plus 10 pt padding top and bottom),
     about 52 pt
  3. the chat stack's header (`app/(app)/chat/_layout.tsx`, `headerShown: true`), about 44 pt
- **The tab bar** sits below the view, and the keyboard covers it.
- **Elsewhere in the app:** `settings/feedback.tsx` uses a hard-coded `keyboardVerticalOffset={90}`. The auth
  screens are full-screen, so 0 is right for them.

## Cause

**Diagnosed from the code, not confirmed on a device:**
- `KeyboardAvoidingView` works out how much padding to add by assuming the view starts at the top of the
  screen, unless `keyboardVerticalOffset` gives the real distance.
- In both chat screens the view starts below the safe area, the team strip and the header, roughly 140–155 pt
  down, but the offset is 0.
- So the padding comes out that much too small. That's more than the height of the message box, which is why
  the box stays fully hidden instead of partly.

## Proposed fix

Give both chat screens the real offset, from one shared place so they can't drift apart:
- **Preferred:** measure where the chat view sits on screen (`measureInWindow` from `onLayout`) and pass its
  top as `keyboardVerticalOffset`. That stays right if the strip, header or safe area change, including with
  large text.
- **Alternative:** add up the parts: the top inset (`useSafeAreaInsets().top`), the strip's height, and the
  header height (`useHeaderHeight()` from `@react-navigation/elements`, already a dependency). This is
  simpler, but it breaks if anything is added above.
- **Not proposed for now:** `react-native-keyboard-controller`'s `KeyboardAvoidingView`, which measures in
  screen coordinates itself. It's a new native dependency.

Also check `settings/feedback.tsx`'s hard-coded 90, which looks like the same problem. That's a separate
ticket if it's wrong.

## Regression test

- **Jest can't show a keyboard.** So test the contract instead: with the view measured at a given top, both
  chat screens pass that number as `keyboardVerticalOffset` (mock `measureInWindow`). This test fails against
  the current hard-coded 0.
- **On a device, as part of the release checks** in `docs/releases/mobile-next.md`:
  - In a channel and in a direct message, tap the box. It sits right above the keyboard, and Send works.
  - Repeat with iOS text size set large.
  - Repeat on a phone without a home button (larger top inset) if one is available.

---

<!-- Everything below is filled in only when the bug is actually fixed, in the same PR. -->

## Fix as implemented

## Verification
