import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../vitest.shared"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      // The E2E smoke test boots a full framework app (plugin registration,
      // HTTP listener, MCP handshake), and the repo-wide guards (hand-off-surface,
      // tool-name-refs, docs-refs, old-names) scan every source of every app and
      // package, the CLI and the VS Code extension included. Locally that takes
      // seconds; in CI's TypeScript job every package's suite (the CLI's 3,850 tests,
      // the extension's Chromium tests) shares one 4-core runner, and a scan took
      // over 30 s there (#452). Same headroom as the hooks below.
      testTimeout: 120_000,
      // Hooks get more: several suites boot the FULL surface in a beforeAll and
      // then scan every widget source (tool-name-refs, hand-off-surface). Under
      // CI load with the suites running in parallel that took over 30 s twice
      // on main (after #370 and #380), against 4–15 s on a quiet runner.
      hookTimeout: 120_000,
      coverage: {
        // Ratchet: frozen 2 points under the baseline. Raise when you push
        // coverage up; never lower. Documented re-baseline 2026-08-13: the
        // composition-root machinery (module selection, env warner, boot
        // warnings — the app's best-tested surface) moved to
        // @miragon/pulse-widget-shell, where the SAME code is covered by
        // composition.test.ts at that package's higher thresholds; the app's
        // percentages shifted without a single line losing tests.
        // Re-baselined UP 2026-08-17: the Postgres persistence (client,
        // migration runner, dashboard store) moved to @miragon/pulse-widget-shell
        // too, and what remains here — the env→backend selection — is covered
        // by persistence-runtime.test.ts; measured statements 82.89 /
        // branches 77.27 / functions 94.44 / lines 83.33. Raised 2026-10-08
        // (#324: `createApp` replaced the e2e re-implementation of the boot,
        // so the suites now execute the real composition root): measured
        // 87.74 / 80.23 / 93.75 / 88.27. Raised 2026-10-09 (#333): the
        // tools/list golden helper (test/golden.ts) is fully exercised by its
        // self-test, and test/ helpers sit inside this package's measured
        // scope (like boot-server.ts) — raised so that padding cannot become
        // headroom for src/: measured 90.09 / 84.67 / 94.73 / 90.52. Raised
        // 2026-10-09 (#322 compat cleanup — the failed-migration close in
        // initRuntime has its recording-client suite): measured 96.62 / 92.46 /
        // 97.29 / 97.9.
        thresholds: { statements: 94, branches: 90, functions: 95, lines: 95 },
      },
    },
  }),
)
