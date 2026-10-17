/**
 * DC-004: when the server did its part (a team created, an invitation
 * accepted) but the phone couldn't save where to land, the person is told,
 * and "Try again" repeats only the local save.
 */

import { Alert } from "react-native";
import { offerRetry } from "../lib/landing-retry";

type Button = { text: string; onPress?: () => void | Promise<void> };
const buttons = () => (jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? []) as Button[];
const press = async (text: string) => {
  await buttons().find((b) => b.text === text)!.onPress?.();
};

beforeEach(() => {
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it("says what happened, with Try again and Not now", async () => {
  void offerRetry("Your team was created, but this phone couldn't switch to it.", jest.fn());

  expect(Alert.alert).toHaveBeenCalledWith(
    "Couldn't switch",
    "Your team was created, but this phone couldn't switch to it.",
    expect.any(Array)
  );
  expect(buttons().map((b) => b.text)).toEqual(["Not now", "Try again"]);
});

it("Try again repeats the save, and resolves when it works", async () => {
  const retry = jest.fn().mockResolvedValue(true);
  const done = offerRetry("msg", retry);

  await press("Try again");
  await done;
  expect(retry).toHaveBeenCalledTimes(1);
});

it("a retry that fails again asks again", async () => {
  const retry = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const done = offerRetry("msg", retry);

  await press("Try again");
  expect(Alert.alert).toHaveBeenCalledTimes(2);
  await press("Try again");
  await done;
  expect(retry).toHaveBeenCalledTimes(2);
});

it("Not now resolves without saving", async () => {
  const retry = jest.fn();
  const done = offerRetry("msg", retry);

  await press("Not now");
  await done;
  expect(retry).not.toHaveBeenCalled();
});
