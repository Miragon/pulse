#!/usr/bin/env node
/**
 * Template pin gate: every package.json of templates/composed-server (server, modules, root,
 * found on disk, so a module added later is checked without an edit here) pins what it shares
 * with the workspace exactly as the workspace does. Runs first in scripts/test-template.sh and,
 * against the real tree, in `pnpm test` (template-pins.test.mjs).
 *
 * - The @miragon/pulse-* libraries (workspace-packages.mjs's isPublishedLibrary) at the workspace
 *   version: exact in every stanza, `^<version>` as a peer (what `workspace:^` packs to).
 *   release-please bumps them together through extra-files, so a drifted pin means an
 *   extra-files entry is missing and customers would install a stale release. A name under the
 *   old @miragon-ai scope (renamed in #415) or a @miragon/pulse-* name the workspace does not
 *   publish as a library would install whatever npm holds under that name (the old scope's last
 *   release, 0.20.0) and stay green, so both fail.
 * - SHARED_LIBRARIES, the libraries a host bundle resolves once (react, react-dom, the query
 *   client, zod, lucide-react): the workspace's one exact pin outside peers, its one peer range
 *   as a peer. Two instances of these resurrect the duplicate-React-context hang (CLAUDE.md
 *   invariant 4) or a second zod, and the starter would build on another toolchain than the
 *   packages it installs. The workspace must agree with itself first: two exact pins or two peer
 *   ranges of one library in the workspace fail. release-please does NOT bump these:
 *   Dependabot's npm entry covers the template next to the root (.github/dependabot.yml), and a
 *   bump that reaches one directory only (a major, a security update, a hand bump) includes the
 *   other by hand.
 * - The official MCP SDK, every @modelcontextprotocol/* package the workspace pins (MCP_SCOPE:
 *   the server and its Node adapter, MCP Apps, the client the tests drive, the inspector the dev
 *   loop starts), the same way: one exact pin, one peer range. They move as one line (the
 *   inspector pins the server, client and core it was built with exactly, MCP Apps and the Node
 *   adapter peer them), so the starter installs the line the workspace tested; Dependabot moves
 *   them together (its `mcp-sdk` group). One the workspace pins but never peers (widget-shell's
 *   own dependencies) a module that imports it peers in a caret range that admits the workspace's
 *   pin (CLAUDE.md, Contracts: a ranged peer), so it dedupes against widget-shell's copy.
 * - FORMATTER, the Prettier the starter formats with (its .prettierrc.json is the root's settings,
 *   held there by check-ratchets.mjs): the workspace's one exact pin, the root manifest's
 *   included. The workspace's Prettier formats the template's files, and the starter's
 *   `pnpm format:check` must accept them as they are; another Prettier or plugin release can
 *   print them differently. Dependabot moves both directories like the shared libraries.
 * - The template's pnpm-workspace.yaml fails an install on an unmet peer (strictPeerDependencies,
 *   held here: without it a split bump installs with a warning).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { isPublishedLibrary, readWorkspace } from "./workspace-packages.mjs"

/** Resolved once per host bundle; pinned in the template exactly as in the workspace. */
export const SHARED_LIBRARIES = [
  "@tanstack/react-query",
  "lucide-react",
  "react",
  "react-dom",
  "zod",
]

/** The starter's formatter and its plugin; pinned in the template exactly as in the workspace. */
export const FORMATTER = ["prettier", "prettier-plugin-tailwindcss"]

/** The official MCP SDK's scope: every package of it the workspace pins, the template pins alike. */
export const MCP_SCOPE = "@modelcontextprotocol/"

export const STANZAS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]
const OLD_SCOPE = "@miragon-ai/"
const PRODUCT_SCOPE = "@miragon/pulse-"

/**
 * The workspace's pins of `libraries`: `{ pins: { [name]: { exact, peer } }, errors }`, read
 * from every workspace manifest (`{ dir, manifest }[]`).
 */
export function workspacePins(packages, libraries = SHARED_LIBRARIES) {
  const seen = Object.fromEntries(
    libraries.map((name) => [name, { exact: new Map(), peer: new Map() }]),
  )
  for (const { dir, manifest } of packages) {
    for (const stanza of STANZAS) {
      for (const [name, spec] of Object.entries(manifest[stanza] ?? {})) {
        if (!(name in seen)) continue
        const kind = stanza === "peerDependencies" ? "peer" : "exact"
        const users = seen[name][kind].get(spec) ?? []
        seen[name][kind].set(spec, [...users, `${dir} (${stanza})`])
      }
    }
  }
  const pins = {}
  const errors = []
  for (const name of libraries) {
    const { exact, peer } = seen[name]
    const list = (specs) => [...specs].map(([spec, users]) => `${spec} in ${users.join(", ")}`)
    if (exact.size !== 1) {
      errors.push(
        exact.size === 0
          ? `the workspace pins ${name} nowhere: no exact pin to hold the template to`
          : `the workspace pins ${name} ${exact.size} ways (${list(exact).join("; ")}): one exact pin`,
      )
    }
    if (peer.size > 1) {
      errors.push(
        `the workspace peers ${name} ${peer.size} ways (${list(peer).join("; ")}): one range`,
      )
    }
    const [exactPin] = exact.keys()
    const [peerRange] = peer.keys()
    pins[name] = { exact: exactPin, peer: peerRange ?? exactPin, peered: peerRange !== undefined }
  }
  return { pins, errors }
}

/** Whether `range`, a caret range `^M.m.p` with M ≥ 1, admits the exact `version` `M.m.p`. */
export function caretAdmits(range, version) {
  const parts = (pattern, value) => pattern.exec(value)?.slice(1).map(Number)
  const low = parts(/^\^(\d+)\.(\d+)\.(\d+)$/, range)
  const at = parts(/^(\d+)\.(\d+)\.(\d+)$/, version)
  if (!low || !at || low[0] === 0 || low[0] !== at[0]) return false
  return at[1] > low[1] || (at[1] === low[1] && at[2] >= low[2])
}

/** An SDK package the workspace pins but never peers: a module peers it in a caret range. */
const rangedSdkPeer = (name, pin, peer) => peer && name.startsWith(MCP_SCOPE) && !pin.peered

/**
 * The drifted and unknown pins of the template's `manifests` (`{ file, manifest }[]`) against
 * the library `versions` (`{ [name]: version }`) and the workspace `pins`.
 */
export function templatePinFindings(manifests, { versions, pins }) {
  const unknown = []
  const drifted = []
  for (const { file, manifest } of manifests) {
    for (const stanza of STANZAS) {
      const peer = stanza === "peerDependencies"
      for (const [name, spec] of Object.entries(manifest[stanza] ?? {})) {
        const where = `${file} (${stanza}): ${name}`
        if (name.startsWith(OLD_SCOPE)) {
          unknown.push(`${where} is the old scope, renamed to ${PRODUCT_SCOPE}*`)
          continue
        }
        if (name.startsWith(PRODUCT_SCOPE) && !(name in versions)) {
          unknown.push(`${where} is no library of this workspace`)
          continue
        }
        let expected
        if (name in versions) expected = peer ? `^${versions[name]}` : versions[name]
        else if (name in pins) expected = peer ? pins[name].peer : pins[name].exact
        if (expected === undefined || spec === expected) continue
        if (name in pins && rangedSdkPeer(name, pins[name], peer)) {
          if (caretAdmits(spec, expected)) continue
          expected = `${expected}, or a caret range that admits it`
        }
        drifted.push(`${where} pinned ${spec}, the workspace ${expected}`)
      }
    }
  }
  return { unknown, drifted }
}

const TEMPLATE_WORKSPACE = "templates/composed-server/pnpm-workspace.yaml"

/** The findings of the template's pnpm-workspace.yaml (`workspaceYaml`, its text): strict peers off. */
export function peerRuleFindings(workspaceYaml) {
  const settings = parse(workspaceYaml) ?? {}
  if (settings.strictPeerDependencies === true) return []
  const found = settings.strictPeerDependencies
  return [
    `${TEMPLATE_WORKSPACE}: strictPeerDependencies is ` +
      `${found === undefined ? "missing" : JSON.stringify(found)}, expected true: an unmet peer ` +
      "must fail the starter's install, or a split @miragon/pulse-* or MCP SDK bump installs",
  ]
}

/** Every @modelcontextprotocol/* name the workspace's manifests (`{ manifest }[]`) pin, sorted. */
export function mcpPackages(packages) {
  const names = new Set()
  for (const { manifest } of packages) {
    for (const stanza of STANZAS) {
      for (const name of Object.keys(manifest[stanza] ?? {})) {
        if (name.startsWith(MCP_SCOPE)) names.add(name)
      }
    }
  }
  return [...names].sort()
}

const SKIP_DIRS = new Set(["node_modules", "dist"])

/** Every package.json under `templateRoot` as `{ file, manifest }`, sorted by path. */
export function templateManifests(templateRoot, rel = "") {
  const dir = path.join(templateRoot, rel)
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const file = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory())
        return SKIP_DIRS.has(entry.name) ? [] : templateManifests(templateRoot, file)
      if (entry.name !== "package.json") return []
      return [{ file, manifest: JSON.parse(readFileSync(path.join(templateRoot, file), "utf8")) }]
    })
    .sort((a, b) => a.file.localeCompare(b.file))
}

/** Every finding for the repo at `root`, as message lines (empty when the template holds). */
export function checkTemplatePins(root) {
  const packages = readWorkspace(root)
  const versions = Object.fromEntries(
    packages.filter(isPublishedLibrary).map(({ manifest }) => [manifest.name, manifest.version]),
  )
  // The root manifest holds the workspace's tooling (Prettier among it); no package is there.
  const rootManifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  const manifests = [{ dir: "the root package.json", manifest: rootManifest }, ...packages]
  const { pins, errors } = workspacePins(manifests, [
    ...SHARED_LIBRARIES,
    ...FORMATTER,
    ...mcpPackages(manifests),
  ])
  const template = templateManifests(path.join(root, "templates/composed-server"))
  if (!template.some(({ file }) => file === "server/package.json")) {
    return [`No server/package.json under templates/composed-server: is the template still there?`]
  }
  const { unknown, drifted } = templatePinFindings(template, { versions, pins })
  const workspaceYaml = path.join(root, TEMPLATE_WORKSPACE)
  const rules = existsSync(workspaceYaml)
    ? peerRuleFindings(readFileSync(workspaceYaml, "utf8"))
    : [`No ${TEMPLATE_WORKSPACE}: the starter installs its workspace and its peer rules from it`]
  const out = []
  if (errors.length > 0) out.push("The workspace disagrees with itself:", ...errors)
  if (unknown.length > 0) {
    out.push(
      "The template depends on packages this workspace does not publish as libraries (pnpm " +
        `would install whatever npm holds under that name; known: ${Object.keys(versions).join(", ")}):`,
      ...unknown,
    )
  }
  if (drifted.length > 0) {
    out.push(
      "Template pins drifted from the workspace (a missing release-please extra-files entry, or " +
        "a bump that skipped the template?):",
      ...drifted,
    )
  }
  if (rules.length > 0) {
    out.push("The template's pnpm-workspace.yaml drifted from its peer contract:", ...rules)
  }
  return out
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const findings = checkTemplatePins(root)
  if (findings.length > 0) {
    for (const line of findings) console.error(line)
    process.exit(1)
  }
  console.log(
    `Template pins: the @miragon/pulse-* libraries, ${SHARED_LIBRARIES.join(", ")}, ` +
      `${FORMATTER.join(", ")} and the ${MCP_SCOPE}* packages match the workspace; the ` +
      "starter's install is strict on peers.",
  )
}
