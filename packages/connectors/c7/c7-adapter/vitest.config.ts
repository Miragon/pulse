import { readFile } from "node:fs/promises"
import { defineConfig, mergeConfig, type Plugin } from "vitest/config"
import { sharedConfig } from "../../../../vitest.shared"

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
        thresholds: { lines: 92, statements: 92, functions: 98, branches: 80 },
      },
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            env: { LC_ALL: "C.UTF-8" },
            include: ["test/**/*.test.ts"],
            exclude: ["test/**/*.engine.test.ts"],
          },
        },
      ],
    },
  }),
)
