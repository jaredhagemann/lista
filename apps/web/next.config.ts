import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  org: "lista",
  project: "lista",

  // Suppress Sentry CLI output during builds
  silent: !process.env.CI,
});
