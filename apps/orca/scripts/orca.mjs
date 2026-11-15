import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const MAC_RESOURCES = "/Applications/Orca.app/Contents/Resources"
const resources = process.env.ORCA_RESOURCES ?? MAC_RESOURCES
const cli = join(resources, "app.asar.unpacked/out/cli/index.js")

if (!existsSync(cli)) {
  console.error(
    `No Orca CLI at ${cli}. Install Orca, or point ORCA_RESOURCES at the resources folder of an Orca release (CI extracts the pinned .deb).`,
  )
  process.exit(1)
}

const args = process.argv.slice(2)
const checks = args[0] === "plugin" && args[1] === "check"
const configHome = checks ? mkdtempSync(join(tmpdir(), "pulse-orca-check-")) : undefined
const env =
  configHome === undefined
    ? process.env
    : { ...process.env, XDG_CONFIG_HOME: configHome, APPDATA: configHome, PULSE_CLI_CONFIG: "" }
const { status } = spawnSync(process.execPath, [cli, ...args], { stdio: "inherit", env })
if (configHome !== undefined) {
  rmSync(configHome, { recursive: true, force: true })
}
process.exit(status ?? 1)
