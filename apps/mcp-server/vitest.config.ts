import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../vitest.shared"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["test/**/*.test.ts"],
      // A handful of in-process boots (the tools/list goldens, the wire contracts, strict input),
      // sub-second locally. The repo-wide source scans that once took over 30 s under CI load
      // (#452) live in scripts/ on node:test now; these are the template's values.
      testTimeout: 30_000,
      hookTimeout: 30_000,
      coverage: {
        // Ratchet: frozen 2 points under the baseline. Raise when you push
        // coverage up; never lower. Documented re-baseline 2026-08-13: the
        // composition-root machinery (module selection, env warner, boot
        // warnings — the app's best-tested surface) moved to
        // @miragon/pulse-widget-shell, where the SAME code is covered by
        // composition.test.ts at that package's higher thresholds; the app's
        // percentages shifted without a single line losing tests.
        // Re-baselined UP 2026-08-17: the Postgres persistence (client,
        // migration runner) moved to @miragon/pulse-widget-shell too, and
        // what remains here — the env→backend selection — is covered
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
