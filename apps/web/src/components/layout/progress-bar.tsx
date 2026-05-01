"use client";

import { AppProgressBar } from "next-nprogress-bar";

export function ProgressBar({ color }: { color?: string | null }) {
  return (
    <AppProgressBar
      color={color ?? "#6366f1"}
      height="3px"
      options={{ showSpinner: false }}
      shallowRouting
    />
  );
}
