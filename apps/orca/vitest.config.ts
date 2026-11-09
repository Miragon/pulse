import { readFile } from "node:fs/promises"
import { defineConfig, mergeConfig, type Plugin } from "vitest/config"
import { sharedConfig } from "../../vitest.shared"

export const bpmnAsText: Plugin = {
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
        include: ["src/worker/**/*.ts", "src/protocol.ts"],
        thresholds: { lines: 98, statements: 98, functions: 97, branches: 91 },
      },
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            include: ["test/**/*.test.ts"],
            exclude: ["test/**/*.orca.test.ts"],
          },
        },
      ],
    },
  }),
)
