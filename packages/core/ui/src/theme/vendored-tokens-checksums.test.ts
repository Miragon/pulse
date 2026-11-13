/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  EQUAL_FIX,
  FORK,
  FORK_FIX,
  checksumsOf,
  fixtureRepo,
  manifestOf,
  sha,
  type FixtureRepo,
} from "./vendored-token-fixtures.test-support.js"

/**
 * The parts of the vendored-token verifier that `vendored-tokens.test.ts` does
 * not reach: the sha256sum list that brand-assets.mjs writes
 * (`.miragon/brand-assets.sha256`) and `valuesOnly`, over fixture repos
 * (`vendored-token-fixtures.test-support.ts`).
 */

const PALETTE = new Map([
  ["--cd-blau", "#335DE5"],
  ["--cd-gruen", "#00E676"],
])

const TOKENS = ":root {\n  --cd-blau: #335DE5;\n  --cd-gruen: #00E676;\n}\n"

const CHECKSUMS = ".miragon/brand-assets.sha256"

let repo: FixtureRepo

beforeEach(() => {
  repo = fixtureRepo(PALETTE)
})

afterEach(() => {
  repo.remove()
})

const write = (files: Record<string, string>) => {
  repo.write(files)
}

const findings = (manifests: string[], scanRoots?: string[], valuesOnly?: string[]) =>
  repo.findings(manifests, scanRoots, valuesOnly)

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
      `--cd-blau in :root differs between the vendored copies (#335DE5 in pulse-ui's palette, app/kit/cd-tokens.generated.css; #1D1D1D in app/old/cd-tokens.generated.css): ${EQUAL_FIX}`,
    ])
  })

  it("lifts only the whole-palette rule: an older copy's theme value is held to the brand-assets copies by scope", () => {
    const dark = (value: string) =>
      `@media screen {\n  [data-cd-theme="dark"] {\n    --cd-ui-grund: ${value};\n  }\n}\n`
    const copies = { "app/ui/cd-tokens.generated.css": `${TOKENS}${dark("#1D1D1D")}` }
    const kit = `:root { --cd-blau: #335DE5; }\n${dark("#6B6666")}`
    write({
      ...copies,
      [CHECKSUMS]: checksumsOf(copies),
      "app/kit/cd-tokens.generated.css": kit,
      "app/kit/manifest.json": manifestOf({ "app/kit/cd-tokens.generated.css": kit }),
    })
    expect(
      findings([CHECKSUMS, "app/kit/manifest.json"], ["app"], ["app/kit/manifest.json"]),
    ).toEqual([
      `--cd-ui-grund in @media screen { [data-cd-theme="dark"] } differs between the vendored copies (#1D1D1D in app/ui/cd-tokens.generated.css; #6B6666 in app/kit/cd-tokens.generated.css): ${EQUAL_FIX}`,
    ])
  })
})
