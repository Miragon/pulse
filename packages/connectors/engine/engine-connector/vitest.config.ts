import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../../vitest.shared"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
      coverage: {
        // Ratchet: frozen 2 points under the baseline. Raise when you
        // push coverage up; never lower. Documented re-baseline 2026-08-13:
        // the profile store + migrations (a well-tested surface) moved to
        // @miragon/pulse-widget-shell, where the SAME code is now held to that
        // package's higher thresholds, so this package's percentages shifted
        // without a single line losing tests (lines 38 → 35 at measured
        // 37.54%). Raised 2026-08-17 with module.ts under test (measured
        // statements 38.66 / branches 27.88 / functions 32.05 / lines 39.09).
        // Raised 2026-08-25 with data/cockpit-data.ts under test (measured
        // statements 42.05 / branches 32.61 / functions 35.76 / lines 42.50).
        // Raised 2026-10-08 with the engine-error/timeout guard end to end
        // (measured statements 48.13 / branches 36.38 / functions 41.03 /
        // lines 48.75). Raised again 2026-10-08 with the ctx.signal sweep over
        // every widget tool and feed (measured statements 54.48 / branches
        // 40.44 / functions 47.64 / lines 55.62). Raised 2026-10-09 with the
        // engine-contract wire guards over every write tool (#328; measured
        // statements 61.86 / branches 44.95 / functions 55.72 / lines 63.05).
        // Raised 2026-10-09 with the #328 review guards: task completion,
        // the incident-detail and task-form widget suites (measured
        // statements 66.56 / branches 52.07 / functions 60.53 / lines 67.96).
        // Raised 2026-10-10 with the #335 honest-numbers guards: the per-
        // builder rejection table and the recording-engine builder suites
        // (measured statements 76.75 / branches 62.91 / functions 73.30 /
        // lines 78.03). Raised 2026-10-10 with the #335 review guards: every
        // read of every builder broken in turn and the capped-scan health
        // suites (measured statements 77.26 / branches 63.80 / functions
        // 74.06 / lines 78.57). The #338 hand-offs rendered against each toolset's
        // live surface (measured standalone 74.1 / 60.39 / 69.05 / 75.57)
        // stay under the stacked floor. Raised 2026-10-10 with the #341
        // write-path suites: the engine-action primitive, the render-level
        // gating of every write site, the seeded standalone refresh (measured
        // 83.38 / 71.81 / 81.22 / 84.39; main was 78.66 / 66.81 / 75.72 / 79.89).
        // #341's cockpit-scope, paged-list and definition-view render suites
        // (measured standalone 79.88 / 68.24 / 76.93 / 81.2) keep the higher
        // write-path floor. Raised 2026-10-11 with the brand gates, the
        // localized verdict and hand-off suites and the view-title tests
        // (#322; measured 88.05 / 76.85 / 87.3 / 89.19). Branches raised with
        // the toolkit 2.8 review fixes (every search box rendered by its name,
        // en and de): measured 88.27 / 77.51 / 87.47 / 89.4. Raised 2026-10-12
        // with the camunda7 CI pass (#322: names, business keys, job order,
        // history marks, cockpit head, landing, settings save bar; measured
        // 88.96 / 78.13 / 88.69 / 90.08). Raised with the camunda7 review
        // fixes (the row menu, the read-only reason matrix, the BPMN viewer's
        // names; measured 89.46 / 78.91 / 89.08 / 90.49).
        thresholds: { statements: 89, branches: 78, functions: 89, lines: 90 },
      },
    },
  }),
)
