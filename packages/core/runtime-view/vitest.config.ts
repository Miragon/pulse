import { readFile } from "node:fs/promises"
import { playwright } from "@vitest/browser-playwright"
import { defineConfig, mergeConfig, type Plugin } from "vitest/config"
import { sharedConfig } from "../../../vitest.shared"

const bpmnAsText: Plugin = {
  name: "bpmn-as-text",
  async load(id) {
    if (!id.endsWith(".bpmn")) return null
    return `export default ${JSON.stringify(await readFile(id, "utf8"))};`
  },
}

export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [bpmnAsText],
    test: {
      clearMocks: true,
      restoreMocks: true,
      coverage: {
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.d.ts"],
        thresholds: {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 90,
          "src/core/**": { lines: 98, statements: 98, functions: 98, branches: 90 },
          "src/model/**": { lines: 98, statements: 98, functions: 98, branches: 88 },
          "src/webview/**": { lines: 78, statements: 78, functions: 78, branches: 68 },
          "src/host-kit/**": { lines: 50, statements: 50, functions: 50, branches: 51 },
        },
      },
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            include: ["test/**/*.test.ts"],
          },
        },
        {
          extends: true,
          oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
          test: {
            name: "browser",
            include: ["test/webview/**/*.test.tsx"],
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              instances: [{ browser: "chromium" }],
            },
          },
        },
      ],
    },
  }),
)
