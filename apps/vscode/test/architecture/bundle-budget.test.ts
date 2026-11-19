import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { gzipSync } from "node:zlib"
import * as esbuild from "esbuild"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { APP_ROOT } from "./support/files.js"

const BUDGET = JSON.parse(
  readFileSync(join(APP_ROOT, "test/__golden__/bundle-budget.json"), "utf8"),
) as Readonly<Record<string, number | string>>

const TIGHT = 0.9

const SINGLE_INSTANCES = ["react", "react-dom", "lucide-react", "@miragon/pulse-ui"] as const

interface WebviewBuild {
  readonly webviewBuildOptions: (options: {
    readonly production: boolean
    readonly outdir: string
  }) => esbuild.BuildOptions
}

const BUILD_OPTIONS = new URL(
  "../../node_modules/@miragon/pulse-runtime-view/scripts/webview-build-options.mjs",
  import.meta.url,
).href

const outdir = mkdtempSync(join(tmpdir(), "pulse-vscode-webview-"))

const ceilings = Object.entries(BUDGET).filter(
  (entry): entry is [string, number] => !entry[0].startsWith("$") && typeof entry[1] === "number",
)

const manifests = new Map<string, { readonly dir: string; readonly name: string } | undefined>()

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

function instancesOf(metafile: esbuild.Metafile, workingDir: string): Map<string, Set<string>> {
  const instances = new Map<string, Set<string>>()
  for (const input of Object.keys(metafile.inputs)) {
    const owner = input.includes(":") ? undefined : packageOf(resolve(workingDir, input))
    if (owner === undefined) continue
    instances.set(owner.name, (instances.get(owner.name) ?? new Set()).add(owner.dir))
  }
  return instances
}

let metafile: esbuild.Metafile
let workingDir: string

beforeAll(async () => {
  const { webviewBuildOptions } = (await import(BUILD_OPTIONS)) as WebviewBuild
  const options = webviewBuildOptions({ production: true, outdir })
  workingDir = options.absWorkingDir ?? process.cwd()
  const result = await esbuild.build({ ...options, metafile: true, logLevel: "silent" })
  metafile = result.metafile
}, 120_000)

afterAll(() => {
  rmSync(outdir, { recursive: true, force: true })
})

describe("the webview bundle", { timeout: 60_000 }, () => {
  test("has a ceiling for the script and the stylesheet it ships", () => {
    expect(ceilings.map(([file]) => file)).toEqual(["webview.js", "webview.css"])
  })

  test.each(ceilings)("%s stays within %i bytes gzip", (file, ceiling) => {
    const gzip = gzipSync(readFileSync(join(outdir, file))).length
    expect(
      gzip,
      `${file} is ${String(gzip)} bytes gzip, over its ceiling: shrink it, or raise the ceiling in test/__golden__/bundle-budget.json with a Ratchet-Exception trailer that says why`,
    ).toBeLessThanOrEqual(ceiling)
    expect(
      gzip,
      `${file} is ${String(gzip)} bytes gzip, well below its ceiling of ${String(ceiling)}: lower the ceiling to about ${String(Math.ceil((gzip * 1.05) / 100) * 100)}`,
    ).toBeGreaterThan(ceiling * TIGHT)
  })

  test.each(SINGLE_INSTANCES)("holds one copy of %s", (name) => {
    const copies = [...(instancesOf(metafile, workingDir).get(name) ?? [])]
    expect(
      copies,
      `${name} is bundled from ${String(copies.length)} folders: a second copy splits the React contexts the kit reads; align the peer set (the exact pins of react, react-dom, @types/react and lucide-react)`,
    ).toHaveLength(1)
  })
})
