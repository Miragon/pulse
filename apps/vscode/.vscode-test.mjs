import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig } from "@vscode/test-cli"

const MAC_INSTALLATION = "/Applications/Visual Studio Code.app/Contents/MacOS/Code"
const installation =
  process.env.PULSE_VSCODE_EXECUTABLE ??
  (existsSync(MAC_INSTALLATION) ? MAC_INSTALLATION : undefined)

export default defineConfig({
  files: "smoke/*.test.cjs",
  extensionDevelopmentPath: ".",
  workspaceFolder: "./smoke/workspace",
  ...(installation === undefined
    ? { version: "stable" }
    : { useInstallation: { fromPath: installation } }),
  launchArgs: [
    "--disable-extensions",
    "--disable-workspace-trust",
    `--user-data-dir=${join(tmpdir(), "pulse-smoke")}`,
  ],
  mocha: { ui: "tdd", timeout: 60_000 },
})
