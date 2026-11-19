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

/** widget-shell's view-half modules the bundle holds code of, as `vite build` builds it. */
async function viewRuntimeModules(): Promise<string[]> {
  const output = await build({
    ...viteConfig,
    configFile: false,
    root: APP,
    mode: "production",
    logLevel: "silent",
    build: { ...viteConfig.build, write: false },
  })
  const outputs = (Array.isArray(output) ? output : [output]) as Rolldown.RolldownOutput[]
  const shell = /\/widget-shell\/dist\/ui\/([^/]+)\.js$/
  return renderedModules(outputs.flatMap(({ output: each }) => each))
    .map((id) => shell.exec(id)?.[1])
    .filter((name): name is string => name !== undefined)
}

describe("the view bundle holds the chat's root alone", { timeout: 120_000 }, () => {
  // A page's root (the web app's) comes from the same `/widgets` entry; tree-shaking keeps it, its
  // browser adapter included, out of the bundle every view document inlines (its gzip budget).
  it("carries the ext-apps adapter and no code of mountPage's page root", async () => {
    const modules = await viewRuntimeModules()
    expect(modules).toEqual(
      expect.arrayContaining(["view-root", "ext-apps-host", "view-runtime", "view-providers"]),
    )
    expect(modules.filter((name) => ["page-root", "browser-view-host"].includes(name))).toEqual([])
  })
})
