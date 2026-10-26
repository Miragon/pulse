import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as esbuild from "esbuild"
import { afterAll, describe, expect, test } from "vitest"

interface EngineCliBuild {
  readonly engineCliBuildOptions: (options: { readonly outfile: string }) => esbuild.BuildOptions
}

const BUILD_SCRIPT = new URL("../../scripts/build.mjs", import.meta.url).href

const installedEngineCli = createRequire(import.meta.url)("@miragon/operate/package.json") as {
  readonly version: string
}

const extensionWithoutDependencies = mkdtempSync(join(tmpdir(), "pulse-vscode-engine-cli-"))

afterAll(() => {
  rmSync(extensionWithoutDependencies, { recursive: true, force: true })
})

describe("the engine CLI the extension ships", { timeout: 60_000 }, () => {
  test("runs from the packaged extension, which carries no node_modules", async () => {
    const { engineCliBuildOptions } = (await import(BUILD_SCRIPT)) as EngineCliBuild
    const outfile = join(extensionWithoutDependencies, "dist", "engine-cli.js")
    writeFileSync(join(extensionWithoutDependencies, "package.json"), '{ "type": "module" }\n')
    await esbuild.build({ ...engineCliBuildOptions({ outfile }), logLevel: "silent" })

    const version = execFileSync(process.execPath, [outfile, "--version"], { encoding: "utf8" })

    expect(version.trim()).toBe(installedEngineCli.version)
  })
})
