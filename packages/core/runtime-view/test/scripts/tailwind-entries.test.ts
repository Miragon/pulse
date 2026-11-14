import { realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as esbuild from "esbuild"
import { describe, expect, test } from "vitest"

interface InlinedStylesheet {
  readonly entry: string
  readonly dependencies: readonly string[]
}

interface TailwindPlugin extends esbuild.Plugin {
  inlined(): InlinedStylesheet[]
}

interface TailwindScript {
  readonly TailwindEntries: new (options: {
    readonly entries: readonly string[]
    readonly production: boolean
  }) => TailwindPlugin
}

interface BuildOptionsScript {
  readonly webviewBuildOptions: (options: {
    readonly production: boolean
    readonly outdir: string
  }) => esbuild.BuildOptions
}

interface Build {
  readonly production: boolean
  readonly minify: boolean
  readonly entry?: string
  readonly entries?: readonly string[]
}

const PACKAGE = fileURLToPath(new URL("../../", import.meta.url))
const ENTRY = fileURLToPath(import.meta.resolve("./fixtures/tailwind/entry.css"))
const AUTO_ENTRY = fileURLToPath(import.meta.resolve("./fixtures/tailwind/auto/entry.css"))
const ROOTED_ENTRY = fileURLToPath(import.meta.resolve("./fixtures/tailwind/rooted/entry.css"))
const MARKUP = join(dirname(ENTRY), "markup.html")
const TAILWIND_INDEX = realpathSync(join(PACKAGE, "node_modules/tailwindcss/index.css"))
const SCRIPTS = new URL("../../scripts/", import.meta.url)

async function tailwindEntries(): Promise<TailwindScript["TailwindEntries"]> {
  const script = (await import(new URL("tailwind-entries.mjs", SCRIPTS).href)) as TailwindScript
  return script.TailwindEntries
}

async function built({ production, minify, entry = ENTRY, entries = [entry] }: Build) {
  const plugin = new (await tailwindEntries())({ entries, production })
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    minify,
    outdir: join(PACKAGE, "out"),
    plugins: [plugin],
    logLevel: "silent",
  })
  return { css: result.outputFiles[0]?.text ?? "", inlined: plugin.inlined() }
}

describe("the Tailwind step of the webview build", { timeout: 30_000 }, () => {
  test("inlines a named entry: the utilities its sources use, preflight, minified", async () => {
    const { css } = await built({ production: true, minify: true })
    expect(css).toContain(".underline{text-decoration-line:underline}")
    expect(css).toContain(".text-center{text-align:center}")
    expect(css).not.toContain("line-through")
    expect(css).toContain("box-sizing:border-box")
    expect(css).not.toMatch(/\{\n/)
  })

  test("optimizes a production build that stays readable, like Orca's", async () => {
    const { css } = await built({ production: true, minify: false })
    expect(css).toMatch(/\.underline \{\n/)
    expect(css).toContain("bottom: -.25em")
  })

  test("leaves a dev build unoptimized", async () => {
    const { css } = await built({ production: false, minify: false })
    expect(css).toMatch(/\.underline \{\n/)
    expect(css).toContain("box-sizing: border-box")
    expect(css).toContain("bottom: -0.25em")
  })

  test("records the stylesheets the entry pulled in, never a source it scanned", async () => {
    const { inlined } = await built({ production: true, minify: true })
    expect(inlined).toEqual([{ entry: ENTRY, dependencies: [TAILWIND_INDEX] }])
  })

  test("scans the entry's own folder when its import names no source", async () => {
    const { css, inlined } = await built({ production: false, minify: false, entry: AUTO_ENTRY })
    expect(css).toContain(".flex {")
    expect(css).toContain(".gap-4 {")
    expect(css).not.toContain("line-through")
    expect(inlined).toEqual([{ entry: AUTO_ENTRY, dependencies: [TAILWIND_INDEX] }])
  })

  test("scans only the folder an explicit source names", async () => {
    const { css } = await built({ production: false, minify: false, entry: ROOTED_ENTRY })
    expect(css).toContain(".italic {")
    expect(css).not.toContain(".uppercase")
  })

  test("leaves every stylesheet it does not name to esbuild", async () => {
    await expect(built({ production: true, minify: true, entries: [] })).rejects.toThrow(
      /Could not resolve "tailwindcss"/,
    )
  })

  test("hands esbuild CSS to load and the files to watch, the scanned sources among them", async () => {
    const plugin = new (await tailwindEntries())({ entries: [ENTRY], production: false })
    const loads: (() => Promise<esbuild.OnLoadResult>)[] = []
    await plugin.setup({
      initialOptions: {},
      onLoad: (_options: esbuild.OnLoadOptions, load: () => Promise<esbuild.OnLoadResult>) => {
        loads.push(load)
      },
    } as unknown as esbuild.PluginBuild)
    const loaded = await loads[0]?.()
    expect(loads).toHaveLength(1)
    expect(loaded).toMatchObject({ loader: "css", resolveDir: dirname(ENTRY) })
    expect(loaded?.watchFiles).toEqual([TAILWIND_INDEX, MARKUP])
  })

  test("watches the folders it scanned, so a new source file rebuilds a watch build", async () => {
    const plugin = new (await tailwindEntries())({ entries: [ROOTED_ENTRY], production: false })
    const loads: (() => Promise<esbuild.OnLoadResult>)[] = []
    await plugin.setup({
      initialOptions: {},
      onLoad: (_options: esbuild.OnLoadOptions, load: () => Promise<esbuild.OnLoadResult>) => {
        loads.push(load)
      },
    } as unknown as esbuild.PluginBuild)
    const loaded = await loads[0]?.()
    expect(loaded?.watchDirs).toEqual([join(dirname(ROOTED_ENTRY), "sub")])
  })
})

describe("the webview build options", () => {
  test("define React's production build for a build that ships, its development build else", async () => {
    const script = (await import(
      new URL("webview-build-options.mjs", SCRIPTS).href
    )) as BuildOptionsScript
    const nodeEnv = (production: boolean) =>
      script.webviewBuildOptions({ production, outdir: PACKAGE }).define?.["process.env.NODE_ENV"]
    expect(nodeEnv(true)).toBe('"production"')
    expect(nodeEnv(false)).toBe('"development"')
  })
})
