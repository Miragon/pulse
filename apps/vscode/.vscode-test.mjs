import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig } from "@vscode/test-cli"
import { isolatedConfigHome } from "./scripts/support/config-home.mjs"

const MAC_INSTALLATION = "/Applications/Visual Studio Code.app/Contents/MacOS/Code"
const installation =
  process.env.PULSE_VSCODE_EXECUTABLE ??
  (existsSync(MAC_INSTALLATION) ? MAC_INSTALLATION : undefined)

function launch(name) {
  return {
    extensionDevelopmentPath: ".",
    ...(installation === undefined
      ? { version: "stable" }
      : { useInstallation: { fromPath: installation } }),
    launchArgs: [
      "--disable-extensions",
      "--disable-workspace-trust",
      "--force-disable-user-env",
      `--user-data-dir=${join(tmpdir(), name)}`,
      ...(process.env.PULSE_VSCODE_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
    ],
    env: isolatedConfigHome(),
    mocha: { ui: "tdd", timeout: 60_000 },
  }
}

export default defineConfig([
  {
    label: "workspace",
    files: "test/smoke/*.test.cjs",
    workspaceFolder: "./test/smoke/workspace",
    ...launch("pulse-smoke"),
  },
  {
    label: "no-folder",
    files: "test/smoke/no-folder/*.test.cjs",
    ...launch("pulse-smoke-no-folder"),
  },
])
