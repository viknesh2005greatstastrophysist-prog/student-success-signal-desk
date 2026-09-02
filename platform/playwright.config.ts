import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Six production origins plus five OAuth redirects routinely exceed three minutes on cold lambdas.
  timeout: 360_000,
  expect: { timeout: 15_000 },
  // This journey mutates the shared synthetic generation. Retrying without a reset would test a different state.
  retries: 0,
  workers: 1,
  use: {
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  reporter: [["line"]],
});
