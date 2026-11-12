import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { afterAll, describe, expect, it } from "vitest"

/**
 * The framework-free entries run in every runtime a Pulse UI has: a browser (the MCP views, the
 * VS Code webview) and Node (the VS Code extension's core). So their files compile against the
 * language alone, without the DOM's or Node's types: a `window`, a `document` or a `process` there
 * fails here, which the import rule `ui-foundation-entries-import-nothing` cannot see.
 */
const SRC = fileURLToPath(new URL(".", import.meta.url))
const FOUNDATION_ENTRIES = ["format", "tones"]

const LANGUAGE_ONLY: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ["lib.es2022.d.ts"],
  types: [],
  strict: true,
  noEmit: true,
}

// A program over the language's own lib loads and checks it cold: on a CI runner the first one
// took 5.9 s, past Vitest's default of 5 s.
const COMPILE_TIMEOUT_MS = 60_000

function sourcesOf(dir: string): string[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => join(dir, file))
}

function compileErrors(files: string[]): string[] {
  const program = ts.createProgram(files, LANGUAGE_ONLY)
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
}

describe("the framework-free entries compile against the language alone", () => {
  it.each(FOUNDATION_ENTRIES)(
    "src/%s: no DOM, no Node",
    (entry) => {
      const files = sourcesOf(join(SRC, entry))
      expect(files).not.toEqual([])
      expect(compileErrors(files)).toEqual([])
    },
    COMPILE_TIMEOUT_MS,
  )

  describe("the check is not blind", () => {
    const dir = mkdtempSync(join(tmpdir(), "foundation-runtime-"))
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true })
    })

    it(
      "fails on a DOM global and on a Node global",
      () => {
        const probe = join(dir, "probe.ts")
        writeFileSync(
          probe,
          "export const here = () => window.location.href\nexport const mode = () => process.env.NODE_ENV\n",
        )
        const errors = compileErrors([probe])
        expect(errors).toHaveLength(2)
        expect(errors[0]).toContain("'window'")
        expect(errors[1]).toContain("'process'")
      },
      COMPILE_TIMEOUT_MS,
    )
  })
})
