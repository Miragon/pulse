import { readFile } from "node:fs/promises"
import { defineConfig, mergeConfig, type Plugin } from "vitest/config"
import { sharedConfig } from "../../vitest.shared"

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
        exclude: ["src/**/*.d.ts", "src/host/extension.ts", "src/host/pulse-extension.ts"],
        thresholds: {
          lines: 56,
          statements: 56,
          functions: 53,
          branches: 50,
        },
      },
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            include: ["test/**/*.test.ts"],
            exclude: ["test/**/*.engine.test.ts"],
          },
        },
      ],
    },
  }),
)
