import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const CONTAINER_CONFIG_HOME = "/tmp/pulse-config-home"

export function isolatedConfigHome() {
  const folder = mkdtempSync(join(tmpdir(), "pulse-config-home-"))
  process.once("exit", () => {
    rmSync(folder, { recursive: true, force: true })
  })
  return configHomeIn(folder)
}

export function keptConfigHome(name) {
  const folder = join(tmpdir(), name)
  mkdirSync(folder, { recursive: true })
  return configHomeIn(folder)
}

function configHomeIn(folder) {
  return { XDG_CONFIG_HOME: folder, APPDATA: folder, PULSE_CLI_CONFIG: "" }
}
