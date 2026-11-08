/// <reference types="node" />
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { vendoredTokenFindings } from "./vendored-tokens.test-support.js"

/**
 * Fixture repos for the vendored-token verifier behind the drift guard in
 * `token-drift.test.ts` (`vendored-tokens.test.ts`, `token-equality.test.ts`).
 * Each case builds its tree under the OS temp folder and removes it afterwards.
 * The token files themselves stay in the test files: pulse-ui's colour gate
 * reads this module as source.
 */

/** The fix a token equality finding names. */
export const EQUAL_FIX =
  "vendor every copy from the same CI release (a re-vendor), never change a value in the repo"

export const sha = (text: string) => createHash("sha256").update(text).digest("hex")

/** A manifest in the docs kit's format for the given files (`pfad` to its content). */
export function manifestOf(files: Record<string, string>, version = "1.20.0"): string {
  return JSON.stringify(
    {
      $kommentar: "fixture",
      version,
      dateien: Object.entries(files).map(([pfad, content]) => ({
        pfad,
        quelle: `assets/${basename(pfad)}`,
        sha256: sha(content),
      })),
    },
    null,
    2,
  )
}

export interface FixtureRepo {
  /** Writes each file under the repo, its folders included. */
  write(files: Record<string, string>): void
  /** The verifier over the repo with the given palette. */
  findings(manifests: string[], scanRoots?: string[]): string[]
  remove(): void
}

export function fixtureRepo(palette: ReadonlyMap<string, string>): FixtureRepo {
  const root = mkdtempSync(join(tmpdir(), "vendored-tokens-"))
  return {
    write(files) {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), content)
      }
    },
    findings: (manifests, scanRoots = ["app"]) =>
      vendoredTokenFindings({ root, manifests, scanRoots, palette }),
    remove() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
