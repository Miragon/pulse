import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { VIEW_BUNDLE_DEDUPE } from "@miragon/pulse-widget-shell/server"
import viteConfig from "../vite.config.js"
import { buildWeb, type WebBuild } from "./web-build.js"

/**
 * What the page holds: the view runtime's page root, never the MCP Apps runtime of a chat, the
 * server half of widget-shell or the engine transport (the page sends its calls to its own server,
 * which talks to the engines), and one copy each of what VIEW_BUNDLE_DEDUPE names (CLAUDE.md
 * invariant 4: a second copy splits the React contexts every widget reads).
 */

let build: WebBuild

beforeAll(async () => {
  build = await buildWeb()
})

afterAll(() => build.remove())

const manifests = new Map<string, { readonly dir: string; readonly name: string } | undefined>()

/** The package a module of the bundle belongs to: the nearest package.json with a name. */
function packageOf(file: string): { readonly dir: string; readonly name: string } | undefined {
  const dir = dirname(file)
  if (manifests.has(dir)) return manifests.get(dir)
  const manifest = join(dir, "package.json")
  const name = existsSync(manifest)
    ? (JSON.parse(readFileSync(manifest, "utf8")) as { name?: string }).name
    : undefined
  const found =
    name !== undefined ? { dir, name } : dir === dirname(dir) ? undefined : packageOf(dir)
  manifests.set(dir, found)
  return found
}

/** The folders each package of the bundle comes from, by its name. */
function copiesOf(modules: readonly string[]): Map<string, Set<string>> {
  const copies = new Map<string, Set<string>>()
  for (const id of modules) {
    const owner = id.startsWith("/") ? packageOf(id) : undefined
    if (owner === undefined) continue
    copies.set(owner.name, (copies.get(owner.name) ?? new Set()).add(owner.dir))
  }
  return copies
}

/** widget-shell's modules the bundle holds code of, by their path in its build. */
const shellModules = () =>
  build.modules
    .map((id) => /\/widget-shell\/dist\/(.+)\.js$/.exec(id)?.[1])
    .filter((name): name is string => name !== undefined)

describe("the page's bundle", () => {
  it("dedupes every package of widget-shell's VIEW_BUNDLE_DEDUPE", () => {
    const dedupe = viteConfig.resolve?.dedupe ?? []
    expect(VIEW_BUNDLE_DEDUPE.filter((name) => !dedupe.includes(name))).toEqual([])
  })

  it("holds the page root and its client of the web app's API, not the chat's root", () => {
    const modules = shellModules()
    expect(modules).toEqual(
      expect.arrayContaining(["ui/page-root", "ui/browser-view-host", "ui/web-caller"]),
    )
    expect(
      modules.filter((name) => /^ui\/(?:view-root|ext-apps-host|view-runtime)$/.test(name)),
    ).toEqual([])
  })

  it("holds no MCP Apps runtime, no server half of widget-shell and no engine transport", () => {
    const names = [...copiesOf(build.modules).keys()]
    expect(names.filter((name) => name.startsWith("@modelcontextprotocol/"))).toEqual([])
    expect(names).not.toContain("@miragon/pulse-http")
    expect(shellModules().filter((name) => !/^(?:ui|protocol)\//.test(name))).toEqual([])
  })

  it.each([...VIEW_BUNDLE_DEDUPE])("holds one copy of %s", (name) => {
    const folders = [...(copiesOf(build.modules).get(name) ?? [])]
    expect(folders, `${name} is bundled from ${folders.length} folders`).toHaveLength(1)
  })
})
