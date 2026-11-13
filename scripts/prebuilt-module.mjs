#!/usr/bin/env node
/**
 * The two manual steps of the prebuilt module's path (the add-widget skill's "A finished HTML
 * view"), for scripts/test-template.sh:
 *
 * - `pin`: the copy of templates/fixtures/prebuilt-module gets what its author declares. At test
 *   time, from the workspace: strict peers then check the version this run packs, and neither the
 *   release train nor Dependabot has one more manifest to move.
 * - `wire`: the starter copy takes the module from its tarball, in the places the skills name
 *   (the dependency with the ext-apps pin, `MODULES`, `MCP_ACTIVE_MODULES`). A template that
 *   changed one of them fails here naming it.
 *
 *   node scripts/prebuilt-module.mjs pin <module copy>
 *   node scripts/prebuilt-module.mjs wire <starter copy> <module.tgz>
 */
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.join(import.meta.dirname, "..")
const EXT_APPS = "@modelcontextprotocol/ext-apps"
const WIDGET_SHELL = "@miragon/pulse-widget-shell"

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"))
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)

const widgetShell = readJson(path.join(ROOT, "packages/core/widget-shell/package.json"))
const extAppsPin = widgetShell.dependencies[EXT_APPS]

function pin(moduleDir) {
  const server = readJson(path.join(ROOT, "templates/composed-server/server/package.json"))
  const file = path.join(moduleDir, "package.json")
  writeJson(file, {
    ...readJson(file),
    peerDependencies: {
      [WIDGET_SHELL]: `^${widgetShell.version}`,
      [EXT_APPS]: `^${extAppsPin}`,
      zod: widgetShell.peerDependencies.zod,
    },
    devDependencies: {
      [WIDGET_SHELL]: widgetShell.version,
      [EXT_APPS]: extAppsPin,
      "@types/node": server.devDependencies["@types/node"],
      typescript: server.devDependencies.typescript,
      zod: server.dependencies.zod,
    },
  })
}

function replaceOnce(file, anchor, replacement) {
  const text = readFileSync(file, "utf8")
  if (!text.includes(anchor)) {
    throw new Error(`prebuilt-module: ${file} no longer holds ${JSON.stringify(anchor)}`)
  }
  writeFileSync(
    file,
    text.replace(anchor, () => replacement),
  )
}

function wire(starterDir, moduleTarball) {
  const manifestFile = path.join(starterDir, "server/package.json")
  const manifest = readJson(manifestFile)
  manifest.dependencies["@acme/mcp-board"] = `file:${moduleTarball}`
  manifest.dependencies[EXT_APPS] = extAppsPin
  writeJson(manifestFile, manifest)
  const setup = path.join(starterDir, "server/src/setup.ts")
  const notesImport = 'import { notesModule } from "@acme/mcp-notes"\n'
  replaceOnce(setup, notesImport, `${notesImport}import { boardModule } from "@acme/mcp-board"\n`)
  replaceOnce(setup, "[engineModule, notesModule]", "[engineModule, notesModule, boardModule]")
  replaceOnce(
    path.join(starterDir, ".env.example"),
    "MCP_ACTIVE_MODULES=engine,notes\n",
    "MCP_ACTIVE_MODULES=engine,notes,board\n",
  )
}

const [command, ...args] = process.argv.slice(2)
if (command === "pin" && args.length === 1) pin(args[0])
else if (command === "wire" && args.length === 2) wire(args[0], args[1])
else {
  console.error("usage: prebuilt-module.mjs pin <module copy> | wire <starter copy> <module.tgz>")
  process.exit(2)
}
