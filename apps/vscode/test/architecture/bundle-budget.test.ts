import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import * as esbuild from "esbuild"
import { afterAll, describe, expect, test } from "vitest"
import { APP_ROOT } from "./support/files.js"

const BUDGET = JSON.parse(
  readFileSync(join(APP_ROOT, "test/__golden__/bundle-budget.json"), "utf8"),
) as Readonly<Record<string, number | string>>

interface WebviewBuild {
  readonly webviewBuildOptions: (options: {
    readonly production: boolean
    readonly outdir: string
  }) => esbuild.BuildOptions
}

const BUILD_OPTIONS = new URL("../../scripts/webview-build-options.mjs", import.meta.url).href

const outdir = mkdtempSync(join(tmpdir(), "pulse-vscode-webview-"))

afterAll(() => {
  rmSync(outdir, { recursive: true, force: true })
})

const ceilings = Object.entries(BUDGET).filter(
  (entry): entry is [string, number] => !entry[0].startsWith("$") && typeof entry[1] === "number",
)

describe("the webview bundle", { timeout: 60_000 }, () => {
  test("has a ceiling for the script it ships", () => {
    expect(ceilings.map(([file]) => file)).toEqual(["webview.js"])
  })

  test.each(ceilings)("%s stays within %i bytes gzip", async (file, ceiling) => {
    const { webviewBuildOptions } = (await import(BUILD_OPTIONS)) as WebviewBuild
    await esbuild.build({
      ...webviewBuildOptions({ production: true, outdir }),
      metafile: false,
      logLevel: "silent",
    })
    const gzip = gzipSync(readFileSync(join(outdir, file))).length
    expect(
      gzip,
      `${file} is ${String(gzip)} bytes gzip, over its ceiling: shrink it, or raise the ceiling in test/__golden__/bundle-budget.json with a Ratchet-Exception trailer that says why`,
    ).toBeLessThanOrEqual(ceiling)
  })
})
