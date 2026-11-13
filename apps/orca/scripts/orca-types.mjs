import { spawnSync } from "node:child_process"
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const app = fileURLToPath(new URL("../", import.meta.url))
const vendored = join(app, "types")
const write = process.argv.includes("--write")

class OrcaTypes {
  static run() {
    const scratch = mkdtempSync(join(tmpdir(), "pulse-orca-types-"))
    try {
      OrcaTypes.generate(scratch)
      const generated = join(scratch, ".orca", "types")
      if (write) {
        rmSync(vendored, { recursive: true, force: true })
        cpSync(generated, vendored, { recursive: true, filter: (path) => !path.endsWith(".json") })
        console.log(`[pulse-orca] wrote ${vendored}`)
        return
      }
      OrcaTypes.compare(generated)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }

  static generate(folder) {
    const orca = join(app, "scripts", "orca.mjs")
    const result = spawnSync(process.execPath, [orca, "plugin", "types", folder], {
      encoding: "utf8",
    })
    if (result.status !== 0) {
      console.error(result.stdout + result.stderr)
      process.exit(result.status ?? 1)
    }
  }

  static compare(generated) {
    const expected = OrcaTypes.filesOf(generated)
    const actual = OrcaTypes.filesOf(vendored)
    const drifted = [...new Set([...expected.keys(), ...actual.keys()])].filter(
      (file) => expected.get(file) !== actual.get(file),
    )
    if (drifted.length > 0) {
      console.error(
        `apps/orca/types differ from this Orca's typings: ${drifted.join(", ")}. Run node apps/orca/scripts/orca-types.mjs --write with the Orca release CI pins.`,
      )
      process.exit(1)
    }
    console.log(`[pulse-orca] types match this Orca (${String(expected.size)} files)`)
  }

  static filesOf(root) {
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))
      .map((entry) => join(entry.parentPath, entry.name))
    return new Map(files.map((file) => [relative(root, file), readFileSync(file, "utf8")]))
  }
}

OrcaTypes.run()
