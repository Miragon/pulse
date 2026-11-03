import { defineConfig, mergeConfig } from "vitest/config"
import { sharedConfig } from "../../../../vitest.shared"

export default mergeConfig(
  sharedConfig,
  defineConfig({
    test: {
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
      coverage: {
        // Ratchet: frozen ~2 points under the baseline. Raise when you push
        // coverage up; never lower. Documented re-baseline 2026-08-13: the
        // shared settings/i18n/toolset boilerplate (a well-tested surface)
        // moved to @miragon/pulse-widget-shell, where the SAME code is held to
        // that package's higher thresholds — this package's percentages
        // shifted without a single line losing tests. Raised 2026-10-08 with
        // the version-compare caveats and the comparison/failure widget
        // helpers under test (measured statements 43.62 / branches 22.13 /
        // functions 40.8 / lines 45.32), and with the Prometheus config +
        // ctx.signal sweep over every widget tool (43.32 / 16.15 / 32.35 / 45.12).
        // Raised 2026-10-10 with the engine-scope sweep over every
        // Prometheus-reading tool and the model-description/summary guards
        // (#336; measured 61.89 / 36.97 / 60.48 / 62.76), and again with the
        // heatmap scope echo (#336 review; measured 66.3 / 40.96 / 63.28 /
        // 67.35). The #338 hand-off builders,
        // every model description and the failure dashboard's cell scope
        // under test (measured standalone 56.65 / 39.72 / 54.63 / 58.48) stay
        // under the stacked floor. Raised 2026-10-11 with the widget DOM
        // suites (`*.test.tsx`: the comparison verdicts, meta lines and
        // hand-offs in de and en) and the brand gates: measured
        // 90.53 / 75.27 / 91.51 / 92.35. Raised again with the ma3 review
        // fixes (the settings section's error state, the heatmap's
        // missing-diagram cause, the measured window lengths under test):
        // measured 92.8 / 79.36 / 92.95 / 94.67. Raised again with the kit
        // layout (the query gate's retry and the settings save's toasts under
        // test): measured 95.08 / 83.15 / 95.21 / 97.21. Raised again with the
        // analytics pass (the name lookup, the named views, the settings
        // validation and the landscape's unknown engines under test):
        // measured 96.82 / 88.5 / 96.94 / 98.44. Raised again with the heatmap moved in from
        // widget-shell with its suites and the process flow's host widgets under test:
        // measured 97.03 / 91.58 / 97.11 / 98.92.
        thresholds: { statements: 95, branches: 89, functions: 95, lines: 96 },
      },
    },
  }),
)
