import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The starter's pins move in lockstep. The @miragon/pulse-* packages release together under one
 * version, and the libraries the view bundle resolves once stay at the versions those packages
 * are built with. A split bump installs, builds and passes every other test: one Pulse package
 * alone (an ungrouped Dependabot pull request), mcp-use alone (`pnpm up --latest`), or the
 * server's pins without a module's. The module then registers its tools through an older
 * widget-shell than the boot runs, or the server ships on an mcp-use Pulse never tested.
 *
 * The anchor is the @miragon/pulse-widget-shell installed for `server/`. Every package.json of
 * the starter (the root, `server/` and each module under `modules/`) pins each @miragon/pulse-*
 * package at its version (`^<version>` as a peer), and each shared library as widget-shell's
 * own package.json does: its devDependencies pin, and its peer range as a peer (mcp-use is exact
 * there too). `strictPeerDependencies` in `pnpm-workspace.yaml` fails most split installs
 * earlier; a module whose own devDependencies satisfy its peers installs and is caught here.
 */

const ROOT = path.join(import.meta.dirname, "..", "..")
const ANCHOR = "@miragon/pulse-widget-shell"
const PULSE_SCOPE = "@miragon/pulse-"

/** Resolved once per view bundle; held to the anchor's own pins. */
const SHARED_LIBRARIES = [
  "@tanstack/react-query",
  "lucide-react",
  "mcp-use",
  "react",
  "react-dom",
  "zod",
]

const STANZAS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const

type Manifest = { name?: string; version?: string } & Partial<
  Record<(typeof STANZAS)[number], Record<string, string>>
>

const readManifest = (file: string): Manifest => JSON.parse(readFileSync(file, "utf8")) as Manifest

/** The starter's package.json files, relative to its root: the root, server/, each module. */
function starterManifests(): string[] {
  const modules = path.join(ROOT, "modules")
  const found = existsSync(modules)
    ? readdirSync(modules, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `modules/${entry.name}/package.json`)
        .filter((file) => existsSync(path.join(ROOT, file)))
        .sort()
    : []
  return ["package.json", "server/package.json", ...found]
}

/** The anchor's package.json as pnpm links it for server/ (or hoisted to the starter root). */
function installedAnchor(): Manifest {
  for (const dir of [path.join(ROOT, "server"), ROOT]) {
    const file = path.join(dir, "node_modules", ANCHOR, "package.json")
    if (existsSync(file)) return readManifest(file)
  }
  throw new Error(`${ANCHOR} is not installed for server/: run pnpm install`)
}

/** What `name` must be pinned at in a peer (`peer`) or another stanza; undefined: not held. */
function expectedSpec(anchor: Manifest, name: string, peer: boolean): string | undefined {
  if (name.startsWith(PULSE_SCOPE)) return peer ? `^${anchor.version}` : anchor.version
  if (!SHARED_LIBRARIES.includes(name)) return undefined
  const exact = anchor.devDependencies?.[name]
  return peer ? (anchor.peerDependencies?.[name] ?? exact) : exact
}

/** One line per pin off the anchor: the file, the stanza, the package and the expected spec. */
function pinFindings(anchor: Manifest): string[] {
  const findings: string[] = []
  for (const file of starterManifests()) {
    const manifest = readManifest(path.join(ROOT, file))
    for (const stanza of STANZAS) {
      for (const [name, spec] of Object.entries(manifest[stanza] ?? {})) {
        const expected = expectedSpec(anchor, name, stanza === "peerDependencies")
        if (expected !== undefined && spec !== expected) {
          findings.push(`${file} (${stanza}): ${name} is ${spec}, expected ${expected}`)
        }
      }
    }
  }
  return findings
}

describe(`every package.json pins like the installed ${ANCHOR}`, () => {
  const anchor = installedAnchor()

  it("pins each @miragon/pulse-* package at its version and each shared library as it does", () => {
    expect(
      pinFindings(anchor),
      `An upgrade moves every @miragon/pulse-* pin in every package.json, modules included, to ` +
        `one version, takes ${SHARED_LIBRARIES.join(", ")} from the new ${ANCHOR}'s ` +
        `package.json, then runs pnpm install (installed: ${ANCHOR} ${anchor.version})`,
    ).toEqual([])
  })

  it("reads a version and a pin of every shared library from the anchor", () => {
    expect(anchor.version).toMatch(/^\d+\.\d+\.\d+/)
    const unpinned = SHARED_LIBRARIES.filter((name) => anchor.devDependencies?.[name] === undefined)
    expect(unpinned).toEqual([])
  })
})
