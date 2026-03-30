import { test as setup } from "@playwright/test";

// Middleware tests authenticate via Bearer tokens obtained programmatically.
// No browser session state is required.
setup("auth setup", async () => {});
