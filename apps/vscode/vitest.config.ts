import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig, mergeConfig, type Plugin } from "vitest/config"
import { sharedConfig } from "../../vitest.shared"

const CONFIG_HOME = mkdtempSync(join(tmpdir(), "pulse-unit-config-"))
process.once("exit", () => {
  rmSync(CONFIG_HOME, { recursive: true, force: true })
})

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
      env: { XDG_CONFIG_HOME: CONFIG_HOME, APPDATA: CONFIG_HOME, PULSE_CLI_CONFIG: "" },
      coverage: {
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.d.ts", "src/host/extension.ts", "src/host/pulse-extension.ts"],
        thresholds: {
          lines: 64,
          statements: 64,
          functions: 62,
          branches: 57,
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
