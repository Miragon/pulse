import type * as esbuild from "esbuild"
import { describe, expect, test } from "vitest"

interface PluginBuild {
  readonly pluginBuilds: (out: string) => Readonly<Record<string, esbuild.BuildOptions>>
}

const PLUGIN_BUILD = new URL("../scripts/build.mjs", import.meta.url).href

describe("the plugin folder's webview", () => {
  test("ships React's production build, readable", async () => {
    const { pluginBuilds } = (await import(PLUGIN_BUILD)) as PluginBuild
    const { webview } = pluginBuilds("/plugin/")
    expect(webview?.define).toEqual({ "process.env.NODE_ENV": '"production"' })
    expect(webview).toMatchObject({ minify: false, sourcemap: false, outdir: "/plugin/editor" })
  })
})
