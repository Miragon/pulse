import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as esbuild from "esbuild"
import { afterAll, describe, expect, test } from "vitest"
import { ENGINE_CLI_PATH } from "../adapters/c7/support/engine-cli-binary.js"

interface EngineCliBuild {
  readonly engineCliBuildOptions: (options: { readonly outfile: string }) => esbuild.BuildOptions
}

const BUILD_SCRIPT = new URL("../../scripts/build.mjs", import.meta.url).href

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

    const versionOf = (cli: string) =>
      execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" })

    expect(versionOf(outfile)).toBe(versionOf(ENGINE_CLI_PATH))
  })
})
