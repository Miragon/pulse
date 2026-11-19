import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig, mergeConfig, type Plugin } from "vitest/config"
import { sharedConfig } from "../../vitest.shared"

const CONFIG_HOME = mkdtempSync(join(tmpdir(), "pulse-orca-config-"))
process.once("exit", () => {
  rmSync(CONFIG_HOME, { recursive: true, force: true })
})

export const ISOLATED_CONFIG_HOME = {
  XDG_CONFIG_HOME: CONFIG_HOME,
  APPDATA: CONFIG_HOME,
  PULSE_CLI_CONFIG: "",
}

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
      env: ISOLATED_CONFIG_HOME,
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
