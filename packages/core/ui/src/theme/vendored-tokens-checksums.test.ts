/// <reference types="node" />
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { vendoredTokenFindings } from "./vendored-tokens.test-support.js"

/**
 * Fixture repos for the parts of the vendored-token verifier that
 * `vendored-tokens.test.ts` does not reach: the sha256sum list that
 * brand-assets.mjs writes (`.miragon/brand-assets.sha256`) and `valuesOnly`.
 */

const PALETTE = new Map([
  ["--cd-blau", "#335DE5"],
  ["--cd-gruen", "#00E676"],
])

const TOKENS = ":root {\n  --cd-blau: #335DE5;\n  --cd-gruen: #00E676;\n}\n"

const FORK = "declares --cd-* outside a sanctioned vendored copy (a fork)"
const FORK_FIX =
  "reference pulse-ui's tokens and roles with var(), or vendor the CI file unchanged with a manifest listed in SANCTIONED_TOKEN_MANIFESTS"

const sha = (text: string) => createHash("sha256").update(text).digest("hex")

/** A manifest in the docs kit's format for the given files (`pfad` to its content). */
function manifestOf(files: Record<string, string>): string {
  return JSON.stringify({
    version: "1.25.1",
    dateien: Object.entries(files).map(([pfad, content]) => ({
      pfad,
      quelle: `assets/${basename(pfad)}`,
      sha256: sha(content),
    })),
  })
}

/** A sha256sum list as brand-assets.mjs writes `.miragon/brand-assets.sha256`. */
function checksumsOf(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([path, content]) => `${sha(content)}  ${path}\n`)
    .join("")
}

const CHECKSUMS = ".miragon/brand-assets.sha256"

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vendored-checksums-"))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function write(files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

const findings = (manifests: string[], scanRoots: string[] = ["app"], valuesOnly?: string[]) =>
  vendoredTokenFindings({ root, manifests, scanRoots, palette: PALETTE, valuesOnly })

describe("vendoredTokenFindings: a sha256sum list from brand-assets.mjs", () => {
  it("sanctions each listed copy in its own folder, a folder at a time", () => {
    const copies = {
      "app/ui/tokens/cd-tokens.generated.css": TOKENS,
      "app/webview/theme/cd-tokens.generated.css": TOKENS,
      "app/webview/theme/cd-canvas.css": ".a { color: var(--cd-blau); }\n",
      "app/webview/theme/cd-tokens.generated.json": '{ "hell": {} }\n',
    }
    write({ ...copies, [CHECKSUMS]: checksumsOf(copies), ".miragon/brand.json": "{}" })
    expect(findings([CHECKSUMS])).toEqual([])
  })

  it("a list that is gone is a finding, never a skip", () => {
    write({ "app/a.css": ".a {}\n" })
    expect(findings([CHECKSUMS])).toEqual([
      expect.stringMatching(
        /^\.miragon\/brand-assets\.sha256: missing \(.*ENOENT.*brand-assets\.mjs/,
      ),
    ])
  })

  it.each([
    ["empty", ""],
    ["a line that is no checksum", `${sha(TOKENS)} app/t.css\n`],
    ["one good and one broken line", `${checksumsOf({ "app/t.css": TOKENS })}nonsense\n`],
  ])("a list that is %s is not a sha256sum list", (_, list) => {
    write({ [CHECKSUMS]: list, "app/t.css": TOKENS })
    expect(findings([CHECKSUMS])).toEqual([
      `${CHECKSUMS}: not a sha256sum list (one "<sha256>  <path>" per line, at least one): let brand-assets.mjs write it`,
      `app/t.css: ${FORK}: ${FORK_FIX}`,
    ])
  })

  it("a path that leaves the repo, an edited copy and a file of its own in a copy's folder", () => {
    write({
      [CHECKSUMS]: checksumsOf({ "../x.css": TOKENS, "app/theme/cd-tokens.generated.css": TOKENS }),
      "app/theme/cd-tokens.generated.css": `${TOKENS}/* edited */`,
      "app/theme/own.css": ".a { color: var(--cd-blau); }\n",
    })
    expect(findings([CHECKSUMS])).toEqual([
      `${CHECKSUMS}: ../x.css is not a repo-relative path: name the copy from the repo root, without a ".." segment`,
      `app/theme/cd-tokens.generated.css: differs from ${CHECKSUMS}: re-vendor it, never edit it in the repo`,
      `app/theme/own.css: in app/theme/ but not in ${CHECKSUMS}: the manifest's folder holds only the vendored files, so move your own file out of it`,
      `app/theme/cd-tokens.generated.css: ${FORK}: ${FORK_FIX}`,
    ])
  })

  it("holds each folder to the whole palette on its own", () => {
    const blau = ":root { --cd-blau: #335DE5; }\n"
    const copies = {
      "app/a/cd-tokens.generated.css": TOKENS,
      "app/b/cd-tokens.generated.css": blau,
    }
    write({ ...copies, [CHECKSUMS]: checksumsOf(copies) })
    expect(findings([CHECKSUMS])).toEqual([
      expect.stringMatching(
        /^\.miragon\/brand-assets\.sha256 \(app\/b\/\): .*declares --cd-gruen, which pulse-ui's copy does/,
      ),
    ])
  })
})

describe("vendoredTokenFindings: valuesOnly", () => {
  it("holds a manifest of an older release to its values, not to the whole palette", () => {
    const older = ":root { --cd-blau: #335DE5; }\n"
    const drifted = ":root { --cd-blau: #1D1D1D; }\n"
    write({
      "app/kit/cd-tokens.generated.css": older,
      "app/kit/manifest.json": manifestOf({ "app/kit/cd-tokens.generated.css": older }),
      "app/old/cd-tokens.generated.css": drifted,
      "app/old/manifest.json": manifestOf({ "app/old/cd-tokens.generated.css": drifted }),
    })
    expect(
      findings(
        ["app/kit/manifest.json", "app/old/manifest.json"],
        ["app"],
        ["app/kit/manifest.json", "app/old/manifest.json"],
      ),
    ).toEqual([
      "app/old/cd-tokens.generated.css: --cd-blau is #1D1D1D, pulse-ui's copy says #335DE5: vendor both from the same CI release (a re-vendor), never change a value in the repo",
    ])
  })
})
