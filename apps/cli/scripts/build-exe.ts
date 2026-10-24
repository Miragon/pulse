/**
 * Builds the standalone executable of operate for this platform (design §20): a copy of the Node.js
 * binary that runs this script, with the standalone bundle injected as single executable
 * application. Releases build it with Node.js 24 on one native runner per target.
 * Usage (from the repository root), writing build/bin/operate-<os>-<arch>[.exe]:
 *   pnpm --fail-if-no-match --filter @miragon/pulse-cli build:standalone
 *   pnpm --fail-if-no-match --filter @miragon/pulse-cli build:exe
 */

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { inject } from "postject"
import { exeTarget, injectOptions, SEA_RESOURCE, seaConfig, sharedLibraries } from "./exe/sea.js"

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url))
const BUNDLE = root("build/standalone/operate.cjs")
const WORK_DIR = root("build/sea")
const OUT_DIR = root("build/bin")

const run = (file: string, args: readonly string[]) => {
  execFileSync(file, args, { stdio: "inherit" })
}

if (!existsSync(BUNDLE)) {
  console.error(
    `${BUNDLE} does not exist. Run \`pnpm --fail-if-no-match --filter @miragon/pulse-cli build:standalone\` first.`,
  )
  process.exit(1)
}
const shared = sharedLibraries(process.config.variables)
if (shared.length > 0) {
  console.error(
    `${process.execPath} links shared libraries (${shared.join(", ")}), which a copy of it needs on every machine. Build with an official Node.js 24 (nodejs.org, nvm, fnm, Volta, setup-node).`,
  )
  process.exit(1)
}
const target = exeTarget(process.platform, process.arch)
const configFile = `${WORK_DIR}/sea-config.json`
const blob = `${WORK_DIR}/sea-prep.blob`
const binary = `${OUT_DIR}/${target.fileName}`

await rm(WORK_DIR, { recursive: true, force: true })
await mkdir(WORK_DIR, { recursive: true })
await mkdir(OUT_DIR, { recursive: true })
await writeFile(configFile, `${JSON.stringify(seaConfig(BUNDLE, blob), null, 2)}\n`)
run(process.execPath, ["--experimental-sea-config", configFile])

await rm(binary, { force: true })
await copyFile(process.execPath, binary)
await chmod(binary, 0o755)
if (target.macho) run("codesign", ["--remove-signature", binary])
await inject(binary, SEA_RESOURCE, await readFile(blob), injectOptions(target))
if (target.macho) run("codesign", ["--sign", "-", binary])

const megabytes = ((await stat(binary)).size / 1024 / 1024).toFixed(1)
console.log(`Built ${binary} (${megabytes} MB, Node.js ${process.version})`)
