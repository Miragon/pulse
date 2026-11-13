import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
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

const { status } = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  stdio: "inherit",
})
process.exit(status ?? 1)
