# BUG-022 — Push can only be switched off for every device at once

**Severity:** P3
**Status:** Won’t fix — one mobile notification preference is enough (user, 2026-09-18)
**Reported:** 2026-09-17, split from [BUG-007](./007-push-delivery-cannot-reach-audience.md)
**Area:** notifications / ios
**Evidence class:** Static — the preference model has no per-device dimension
**Last verified:** `HEAD` of `fix/007-push-delivery-audience`, code inspection, 2026-09-17

## Symptom

A parent with the app on a phone and a tablet gets every push on both, and the only control is
`notification_preferences.push_enabled`, which silences **all** their devices. There is no way to say "not
on the tablet".

Until BUG-007 this was hidden: registering a second device deleted the first device's token, so only one
device ever received anything. Now that every device is kept, the missing control is visible.

## Reproduction

**Static.** Sign in on two devices, register both, and look for a per-device switch: the settings screen
offers one push toggle for the account.

**Expected:** each registered device can be switched off on its own.
**Actual:** one switch governs every device.

## Evidence

- Preference columns: `supabase/migrations/20260101000000_initial_schema.sql:87` (`push_enabled` is
  per profile) and `20260307000000_team_chat.sql:64` (`chat_push_enabled`)
- Device rows carry no state of their own: `push_subscriptions` has no enabled flag or label
- Registration: `apps/mobile/lib/notifications.ts` (`registerPushToken`)
- Resolution: `apps/web/src/lib/notifications/recipients.ts` sends to every device the adult has

## Product decisions

The requirement itself is settled — "mobile push needs a per-device opt-out"
(`docs/specs/archive/team-chat.md:237`), carried into D2's "do not reopen" list. What is open is the shape.

| Question | Recommendation | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| How is a device named? | Capture the device name at registration (`Device.deviceName`), fall back to "This device" | Open | | |
| What can be switched off per device? | All push for that device, rather than per category | Open | | |
| What happens to a device that stops reporting? | Prune a token the push service rejects as unregistered | Open | | |

## Proposed fix

Add `enabled` and a label to `push_subscriptions`, set the label at registration, filter on it in
`resolveRecipients`, and list the devices in the mobile settings screen with a switch each.

## Regression test

A recipient with two devices, one switched off, receives push on the other only. Switching off the last
device is not the same as opting out of the category: a new device registers enabled.

---

## Closed 2026-09-18 — Won’t fix

A per-device opt-out is not wanted at this stage (user, 2026-09-18). One preference governs all of a
person’s devices, which is what `push_enabled` and `chat_push_enabled` already do, and every device the
person has registered receives what that preference allows.

**What remains true:** [BUG-007](./007-push-delivery-cannot-reach-audience.md) fixed the delivery half —
registering a second device no longer silences the first — so a family with two devices gets notifications
on both. The only thing missing is the ability to switch one of them off on its own.

**If it comes back:** the sketch under Proposed fix still applies, and the tests under Regression test
describe what it would need.
