import { defineConfig } from "@playwright/test"

const CI = Boolean(process.env.CI)

/**
 * test:web: the web app's page (apps/web, built) on the real server, signed in through a fake
 * identity provider, in Chromium; see global-setup.ts and ../README.md.
 */
export default defineConfig({
  testDir: ".",
  // Under the .gitignore entry, as the CI artifact upload names it. A sibling of test:host's, since
  // Playwright empties its output directory at every run.
  outputDir: "../../test-results/web",
  globalSetup: "./global-setup.ts",
  timeout: 45_000,
  // Every scenario signs in in its own browser context, and what one ends at an identity provider
  // is its own session; the servers and the providers are shared.
  fullyParallel: true,
  workers: CI ? 2 : undefined,
  // Never retry: a retry turns a regression that fails one run in N into a green "flaky" pass.
  // A red run is the signal, investigate it with the retained trace.
  retries: 0,
  forbidOnly: CI,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    colorScheme: "light",
    locale: "en-US",
    // A desktop's window: from 64rem on the page's navigation stands beside the view, which
    // keeps about the 1000 px it had before the frame took its 15rem and margins.
    viewport: { width: 1280, height: 780 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
})
