import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { build, type Rolldown } from "vite"
import { describe, expect, it } from "vitest"
import { VIEW_BUNDLE_DEDUPE, viewBundleWatchPlugin } from "@miragon/pulse-widget-shell/server"
import { renderedModules } from "../../../scripts/third-party-licenses.mjs"
import viteConfig from "../vite.config.js"

const APP = realpathSync(fileURLToPath(new URL("..", import.meta.url)))

/**
 * CLAUDE.md invariant 4: the view bundle resolves widget-shell's VIEW_BUNDLE_DEDUPE to one
 * instance each, or a widget reads a second React context and every in-widget query hangs on
 * "Loading…" (test:host's in-widget query scenario is the end-to-end proof on the built bundle).
 */
describe("the view bundle's vite config", () => {
  it("dedupes every package of widget-shell's VIEW_BUNDLE_DEDUPE", () => {
    const dedupe = viteConfig.resolve?.dedupe ?? []
    expect(VIEW_BUNDLE_DEDUPE.filter((name) => !dedupe.includes(name))).toEqual([])
  })

  // `pnpm dev`: the watcher's first build would rewrite the bundle and restart the server.
  it("leaves an unchanged bundle unwritten in watch mode", () => {
    const names = (viteConfig.plugins ?? [])
      .flat()
      .map((plugin) =>
        plugin && typeof plugin === "object" && "name" in plugin ? plugin.name : undefined,
      )
    expect(names).toContain(viewBundleWatchPlugin().name)
  })
})

/** Every module the bundle holds code of, as `vite build` builds it (one build per run). */
let bundled: Promise<string[]> | undefined

function bundleModules(): Promise<string[]> {
  bundled ??= buildModules()
  return bundled
}

async function buildModules(): Promise<string[]> {
  const output = await build({
    ...viteConfig,
    configFile: false,
    root: APP,
    mode: "production",
    logLevel: "silent",
    build: { ...viteConfig.build, write: false },
  })
  const outputs = (Array.isArray(output) ? output : [output]) as Rolldown.RolldownOutput[]
  return renderedModules(outputs.flatMap(({ output: each }) => each))
}

/** widget-shell's view-half modules the bundle holds code of. */
async function viewRuntimeModules(): Promise<string[]> {
  const shell = /\/widget-shell\/dist\/ui\/([^/]+)\.js$/
  return (await bundleModules())
    .map((id) => shell.exec(id)?.[1])
    .filter((name): name is string => name !== undefined)
}

describe("the view bundle holds the chat's root alone", { timeout: 120_000 }, () => {
  // A page's roots (the web app's app root and the view it shows in it, a page of one view) come
  // from the same `/widgets` entry; tree-shaking keeps them, their browser adapter included, out of
  // the bundle every view document inlines (its gzip budget), and nothing of the web app's router
  // reaches it: the chat has no address.
  it("carries the ext-apps adapter and no code of a page's roots", async () => {
    const modules = await viewRuntimeModules()
    expect(modules).toEqual(
      expect.arrayContaining(["view-root", "ext-apps-host", "view-runtime", "view-providers"]),
    )
    const pageRoots = ["app-root", "page-view", "page-root", "browser-view-host"]
    expect(modules.filter((name) => pageRoots.includes(name))).toEqual([])
  })

  // The web app's screens (D10) are the page's own: the chat's cockpit keeps its routes, so no
  // module of the web app, no screen block of @miragon/pulse-blocks (its board's tiles stay) and
  // nothing of @miragon/pulse-screens reaches the bundle every view document inlines.
  it("carries none of the web app's screens, their blocks or the screens' format", async () => {
    const modules = await bundleModules()
    expect(modules.filter((id) => /\/core\/blocks\/dist\/board\//.test(id))).not.toEqual([])
    expect(
      modules.filter((id) =>
        /\/apps\/web\/|\/core\/blocks\/(?:dist|src)\/screens\/|\/core\/screens\//.test(id),
      ),
    ).toEqual([])
  })
})
