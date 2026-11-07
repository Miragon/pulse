import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The starter's pins move in lockstep. The @miragon/pulse-* packages release together under one
 * version, and the libraries the view bundle resolves once and the MCP SDK the boot runs on stay
 * at the versions those packages are built with. A split bump installs, builds and passes every
 * other test: one Pulse package alone (an ungrouped Dependabot pull request), the SDK alone
 * (`pnpm up --latest`), or the server's pins without a module's. The module then registers its
 * tools through an older widget-shell than the boot runs, or the server ships on an SDK Pulse
 * never tested.
 *
 * The anchor is the @miragon/pulse-widget-shell installed for `server/`. Every package.json of
 * the starter (the root, `server/`, each module and any package you add) pins each
 * @miragon/pulse-* package at its version (`^<version>` as a peer), and each shared library and
 * each @modelcontextprotocol/* package widget-shell pins as its own package.json does: its exact
 * pin, and its peer range as a peer. An SDK package widget-shell brings along but does not peer
 * (ext-apps, say) a module that imports it peers in a caret range that admits widget-shell's pin,
 * like zod, so the one copy satisfies it. `strictPeerDependencies` in `pnpm-workspace.yaml` fails
 * most split installs earlier; a module whose own devDependencies satisfy its peers installs and
 * is caught here.
 */

const ROOT = path.join(import.meta.dirname, "..", "..")
const ANCHOR = "@miragon/pulse-widget-shell"
const PULSE_SCOPE = "@miragon/pulse-"

/** Resolved once per view bundle; held to the anchor's own pins. */
const SHARED_LIBRARIES = ["@tanstack/react-query", "lucide-react", "react", "react-dom", "zod"]

/** The official MCP SDK: a package of it the anchor pins is held to the anchor's pin. */
const MCP_SCOPE = "@modelcontextprotocol/"

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

type Found = { file: string; manifest: Manifest }

/** Build output and installs; dot-directories (.git) are skipped too. */
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"])

/**
 * Every package.json of the starter below `rel`, relative to its root and sorted: the root,
 * server/, each module and any package you add, wherever pnpm-workspace.yaml finds it.
 */
function starterManifests(rel = ""): Found[] {
  return readdirSync(path.join(ROOT, rel), { withFileTypes: true })
    .flatMap((entry): Found[] => {
      const file = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        return SKIP_DIRS.has(entry.name) || entry.name.startsWith(".") ? [] : starterManifests(file)
      }
      if (entry.name !== "package.json") return []
      return [{ file, manifest: readManifest(path.join(ROOT, file)) }]
    })
    .sort((a, b) => a.file.localeCompare(b.file))
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
  if (!SHARED_LIBRARIES.includes(name) && !name.startsWith(MCP_SCOPE)) return undefined
  const exact = anchor.devDependencies?.[name] ?? anchor.dependencies?.[name]
  if (exact === undefined) return undefined
  return peer ? (anchor.peerDependencies?.[name] ?? exact) : exact
}

/** Whether `range`, a caret range `^M.m.p` with M >= 1, admits the exact `version` `M.m.p`. */
function caretAdmits(range: string, version: string): boolean {
  const parts = (pattern: RegExp, value: string) => pattern.exec(value)?.slice(1).map(Number)
  const low = parts(/^\^(\d+)\.(\d+)\.(\d+)$/, range)
  const at = parts(/^(\d+)\.(\d+)\.(\d+)$/, version)
  if (!low || !at || low[0] === 0 || low[0] !== at[0]) return false
  return at[1] > low[1] || (at[1] === low[1] && at[2] >= low[2])
}

/** An SDK package the anchor pins but does not peer: a module peers it in a caret range. */
const rangedSdkPeer = (anchor: Manifest, name: string, peer: boolean) =>
  peer && name.startsWith(MCP_SCOPE) && anchor.peerDependencies?.[name] === undefined

/** One line per pin of `manifests` off the anchor: the file, the stanza, the package, the spec. */
function pinFindings(anchor: Manifest, manifests: Found[]): string[] {
  const findings: string[] = []
  for (const { file, manifest } of manifests) {
    for (const stanza of STANZAS) {
      const peer = stanza === "peerDependencies"
      for (const [name, spec] of Object.entries(manifest[stanza] ?? {})) {
        const expected = expectedSpec(anchor, name, peer)
        if (expected === undefined || spec === expected) continue
        const ranged = rangedSdkPeer(anchor, name, peer)
        if (ranged && caretAdmits(spec, expected)) continue
        const or = ranged ? ", or a caret range that admits it" : ""
        findings.push(`${file} (${stanza}): ${name} is ${spec}, expected ${expected}${or}`)
      }
    }
  }
  return findings
}

describe(`every package.json pins like the installed ${ANCHOR}`, () => {
  const anchor = installedAnchor()

  it("pins each @miragon/pulse-* package at its version and each shared library as it does", () => {
    expect(
      pinFindings(anchor, starterManifests()),
      `An upgrade moves every @miragon/pulse-* pin in every package.json, modules included, to ` +
        `one version, takes ${SHARED_LIBRARIES.join(", ")} and the ${MCP_SCOPE}* pins from the ` +
        `new ${ANCHOR}'s package.json, then runs pnpm install (installed: ${ANCHOR} ` +
        `${anchor.version})`,
    ).toEqual([])
  })

  it("names a module left behind, lucide-react and the SDK bumped alone", () => {
    const planted: Manifest = {
      version: "0.26.0",
      dependencies: { "@modelcontextprotocol/node": "2.1.2" },
      devDependencies: {
        "@modelcontextprotocol/server": "2.4.0",
        "lucide-react": "1.67.0",
        react: "19.2.1",
      },
      peerDependencies: {
        "@modelcontextprotocol/server": "^2.4.0",
        "lucide-react": "^0.562.0 || ^1.0.0",
        react: "^19.2.0",
      },
    }
    const split: Found[] = [
      {
        file: "server/package.json",
        manifest: {
          dependencies: {
            "@miragon/pulse-widget-shell": "0.26.0",
            "@modelcontextprotocol/node": "2.1.3",
            "@modelcontextprotocol/server": "2.5.0",
            "lucide-react": "1.68.0",
          },
          // An SDK package the anchor does not pin (the inspector) stays the starter's own.
          devDependencies: {
            "@modelcontextprotocol/inspector": "2.15.0",
            react: "19.2.1",
            vitest: "4.0.0",
          },
        },
      },
      {
        file: "modules/notes/package.json",
        manifest: {
          devDependencies: { "@miragon/pulse-widget-shell": "0.25.0", react: "19.2.1" },
          peerDependencies: { "@miragon/pulse-widget-shell": "^0.25.0", react: "^19.2.0" },
        },
      },
    ]
    expect(pinFindings(planted, split)).toEqual([
      "server/package.json (dependencies): @modelcontextprotocol/node is 2.1.3, expected 2.1.2",
      "server/package.json (dependencies): @modelcontextprotocol/server is 2.5.0, expected 2.4.0",
      "server/package.json (dependencies): lucide-react is 1.68.0, expected 1.67.0",
      "modules/notes/package.json (devDependencies): @miragon/pulse-widget-shell is 0.25.0, expected 0.26.0",
      "modules/notes/package.json (peerDependencies): @miragon/pulse-widget-shell is ^0.25.0, expected ^0.26.0",
    ])
  })

  // A module that imports ext-apps itself (its `registerAppTool`) peers it in a range.
  it("admits a caret peer of an SDK package the anchor brings along but does not peer", () => {
    const anchor: Manifest = {
      version: "0.26.0",
      dependencies: { "@modelcontextprotocol/ext-apps": "2.0.4" },
    }
    const module = (range: string): Found[] => [
      {
        file: "modules/tickets/package.json",
        manifest: {
          devDependencies: { "@modelcontextprotocol/ext-apps": "2.0.4" },
          peerDependencies: { "@modelcontextprotocol/ext-apps": range },
        },
      },
    ]
    for (const range of ["^2.0.4", "^2.0.0", "2.0.4"]) {
      expect(pinFindings(anchor, module(range)), range).toEqual([])
    }
    for (const range of ["^2.0.5", "^2.1.0", "^3.0.0", "~2.0.4", ">=2.0.0"]) {
      expect(pinFindings(anchor, module(range))).toEqual([
        `modules/tickets/package.json (peerDependencies): @modelcontextprotocol/ext-apps is ${range}, ` +
          "expected 2.0.4, or a caret range that admits it",
      ])
    }
  })

  it("reads a version and a pin of every shared library from the anchor", () => {
    expect(anchor.version).toMatch(/^\d+\.\d+\.\d+/)
    const unpinned = SHARED_LIBRARIES.filter((name) => anchor.devDependencies?.[name] === undefined)
    expect(unpinned).toEqual([])
  })
})
