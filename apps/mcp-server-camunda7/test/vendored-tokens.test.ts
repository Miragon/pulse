import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { rootTokens, vendoredTokenFindings } from "./vendored-tokens.js"

/**
 * Fixture repos for the vendored-token verifier behind the drift guard in
 * `ui-stylesheet.test.ts`. Each case builds its tree under the OS temp
 * folder and removes it afterwards. The cases include copies the repo does not
 * hold yet (a second sanctioned copy, the App and web variant of the CI token
 * file under an extension's webview), so the guard is ready before they land.
 */

const PALETTE = new Map([
  ["--cd-blau", "#335DE5"],
  ["--cd-gruen", "#00E676"],
])

/** A minimal token file on the palette. */
const TOKENS = ":root {\n  --cd-blau: #335DE5;\n  --cd-gruen: #00E676;\n}\n"

/** Shaped like the CI's App and web variant: roles, theme and contrast scopes, media blocks. */
const APP_VARIANT = `/* AUTOMATISCH GENERIERT aus brand/tokens.json. */
/* App- und Web-Variante. Palette, Statusfarben und ui.* stehen nur in :root. */
:root {
  --cd-blau: #335DE5;
  --cd-gruen: #00E676;
  --cd-ui-grund: #FFFFFF;
  --cd-ui-text: #1D1D1D;
}
[data-cd-theme="system"] {
  color-scheme: light dark;
}
@media screen {
  [data-cd-theme="dark"] {
    --cd-ui-grund: #1D1D1D;
    --cd-ui-text: #FFFFFF;
    --cd-blau: #6B8AFF;
  }
  [data-cd-theme="dark"] ::selection { background-color: #1D1D1D; color: #FFFFFF; }
}
@media screen and (prefers-color-scheme: dark) {
  [data-cd-theme="system"] {
    --cd-ui-grund: #1D1D1D;
  }
}
:root:not([data-cd-theme="dark"]) .cd-nur-dunkel { display: none !important; }
@media print { :root .cd-nur-dunkel { display: none !important; } }
[data-cd-kontrast="hoch"] {
  --cd-ui-text: #1D1D1D;
}
`

/** The App variant's canvas file: references only, no declaration. */
const APP_CANVAS = ".djs-container { background: var(--cd-ui-grund); color: var(--cd-ui-text); }\n"

const APP_JSON = '{ "cd": { "blau": "#335DE5" } }\n'

const sha = (text: string) => createHash("sha256").update(text).digest("hex")

/** A manifest in the docs kit's format for the given files (`pfad` to its content). */
function manifestOf(files: Record<string, string>, version = "1.20.0"): string {
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

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "vendored-tokens-"))
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

const findings = (manifests: string[], scanRoots: string[] = ["app"]) =>
  vendoredTokenFindings({ root, manifests, scanRoots, palette: PALETTE })

const FORK = "declares --cd-* outside a sanctioned vendored copy (a fork)"

describe("vendoredTokenFindings: sanctioned copies pass", () => {
  it("a copy its sanctioned manifest lists, byte-equal and on the palette", () => {
    write({
      "app/theme/cd-tokens.generated.css": TOKENS,
      "app/theme/manifest.json": manifestOf({ "app/theme/cd-tokens.generated.css": TOKENS }),
      "app/theme/.DS_Store": "finder",
    })
    expect(findings(["app/theme/manifest.json"])).toEqual([])
  })

  it("two sanctioned copies: a docs kit shape and the App variant under an extension's webview", () => {
    const kitTheme = ".vp-doc a { color: var(--cd-blau-link); }\n"
    write({
      "docs/kit/manifest.json": manifestOf({
        "docs/kit/check.mjs": "export {}\n",
        "docs/kit/theme/cd-tokens.generated.css": TOKENS,
        "docs/kit/theme/miragon.css": kitTheme,
        // Pinned by the manifest but outside its folder, like the kit's logos.
        "docs/public/logo/mark.svg": "<svg/>",
      }),
      "docs/kit/check.mjs": "export {}\n",
      "docs/kit/theme/cd-tokens.generated.css": TOKENS,
      "docs/kit/theme/miragon.css": kitTheme,
      "docs/public/logo/mark.svg": "<svg/>",
      "apps/vscode/src/webview/theme/manifest.json": manifestOf({
        "apps/vscode/src/webview/theme/cd-tokens.generated.css": APP_VARIANT,
        "apps/vscode/src/webview/theme/cd-canvas.css": APP_CANVAS,
        "apps/vscode/src/webview/theme/cd-tokens.generated.json": APP_JSON,
      }),
      "apps/vscode/src/webview/theme/cd-tokens.generated.css": APP_VARIANT,
      "apps/vscode/src/webview/theme/cd-canvas.css": APP_CANVAS,
      "apps/vscode/src/webview/theme/cd-tokens.generated.json": APP_JSON,
      "apps/vscode/src/webview/styles/base.css": "body { color: var(--cd-ui-text); }\n",
    })
    expect(
      findings(
        ["docs/kit/manifest.json", "apps/vscode/src/webview/theme/manifest.json"],
        ["apps", "docs"],
      ),
    ).toEqual([])
  })

  it("a comment or a var() reference is no declaration", () => {
    write({ "app/x.css": "/* --cd-blau: red; */\n.a { color: var(--cd-blau); }\n" })
    expect(findings([])).toEqual([])
  })

  it.each(["node_modules", "dist", "cache", ".vitepress-cache", "test-results"])(
    "a copy under %s/ is install or build output and not read (the toolkit's copy stays out)",
    (dir) => {
      write({ [`app/${dir}/t/cd-tokens.generated.css`]: TOKENS })
      expect(findings([])).toEqual([])
    },
  )
})

describe("vendoredTokenFindings: forks fail", () => {
  it("a stylesheet that declares a --cd-* with no manifest", () => {
    write({ "apps/x/src/app.css": ".a { --cd-blau: red; }\n" })
    expect(findings([], ["apps"])).toEqual([`apps/x/src/app.css: ${FORK}: ${forkFix()}`])
  })

  it("a valid manifest next to the copy sanctions nothing unless the caller lists it", () => {
    write({
      "app/theme/cd-tokens.generated.css": TOKENS,
      "app/theme/manifest.json": manifestOf({ "app/theme/cd-tokens.generated.css": TOKENS }),
    })
    expect(findings([])).toEqual([`app/theme/cd-tokens.generated.css: ${FORK}: ${forkFix()}`])
  })

  it("a copy edited after vendoring is reported and loses its sanction", () => {
    write({
      "app/theme/cd-tokens.generated.css": `${TOKENS}/* edited */`,
      "app/theme/manifest.json": manifestOf({ "app/theme/cd-tokens.generated.css": TOKENS }),
    })
    expect(findings(["app/theme/manifest.json"])).toEqual([
      "app/theme/cd-tokens.generated.css: differs from app/theme/manifest.json: re-vendor it, never edit it in the repo",
      `app/theme/cd-tokens.generated.css: ${FORK}: ${forkFix()}`,
    ])
  })

  it("a listed copy outside the manifest's folder is pinned but not sanctioned", () => {
    write({
      "other/x.css": TOKENS,
      "app/theme/manifest.json": manifestOf({ "other/x.css": TOKENS }),
    })
    expect(findings(["app/theme/manifest.json"], ["app", "other"])).toEqual([
      `other/x.css: ${FORK}: ${forkFix()}`,
    ])
  })
})

describe("vendoredTokenFindings: a sanctioned manifest fails closed", () => {
  it("a sanctioned manifest that is gone is a finding, never a skip", () => {
    write({ "app/a.css": ".a {}\n" })
    const [finding, ...rest] = findings(["app/theme/manifest.json"])
    expect(rest).toEqual([])
    expect(finding).toMatch(/^app\/theme\/manifest\.json: missing or not JSON \(.*ENOENT/)
    expect(finding).toContain("SANCTIONED_TOKEN_MANIFESTS")
  })

  it("a manifest that is not JSON", () => {
    write({ "app/theme/manifest.json": "{ version: 1" })
    expect(findings(["app/theme/manifest.json"])).toEqual([
      expect.stringMatching(/^app\/theme\/manifest\.json: missing or not JSON \(SyntaxError/),
    ])
  })

  const entry = { pfad: "app/theme/t.css", quelle: "assets/t.css", sha256: sha(TOKENS) }
  it.each([
    ["null", null],
    ["an array", []],
    ["no version", { dateien: [entry] }],
    ["a version that is not x.y.z", { version: "latest", dateien: [entry] }],
    ["a version that is no string", { version: 1, dateien: [entry] }],
    ["no dateien", { version: "1.0.0" }],
    ["dateien that is no array", { version: "1.0.0", dateien: entry }],
    ["no file at all", { version: "1.0.0", dateien: [] }],
    ["a null entry", { version: "1.0.0", dateien: [null] }],
    ["a pfad that is no string", { version: "1.0.0", dateien: [{ ...entry, pfad: 7 }] }],
    ["an empty pfad", { version: "1.0.0", dateien: [{ ...entry, pfad: "" }] }],
    ["no quelle", { version: "1.0.0", dateien: [{ pfad: entry.pfad, sha256: entry.sha256 }] }],
    ["an empty quelle", { version: "1.0.0", dateien: [{ ...entry, quelle: "" }] }],
    ["no sha256", { version: "1.0.0", dateien: [{ pfad: entry.pfad, quelle: entry.quelle }] }],
    ["a short sha256", { version: "1.0.0", dateien: [{ ...entry, sha256: "abc" }] }],
    [
      "an uppercase sha256",
      { version: "1.0.0", dateien: [{ ...entry, sha256: entry.sha256.toUpperCase() }] },
    ],
  ])("a manifest with %s is not a vendor manifest", (_, manifest) => {
    write({ "app/theme/manifest.json": JSON.stringify(manifest), "app/theme/t.css": TOKENS })
    const result = findings(["app/theme/manifest.json"])
    expect(result).toEqual([
      expect.stringMatching(/^app\/theme\/manifest\.json: not a vendor manifest \(version x\.y\.z/),
      `app/theme/t.css: ${FORK}: ${forkFix()}`,
    ])
  })

  it("a listed file that is missing or a folder", () => {
    write({
      "app/theme/manifest.json": manifestOf({ "app/theme/gone.css": TOKENS, "app/theme/sub": "" }),
      "app/theme/sub/x.txt": "x",
    })
    expect(findings(["app/theme/manifest.json"])).toEqual([
      "app/theme/gone.css: listed in app/theme/manifest.json but missing: re-vendor it from the CI, or regenerate the manifest",
      "app/theme/sub: listed in app/theme/manifest.json but missing: re-vendor it from the CI, or regenerate the manifest",
      "app/theme/sub/x.txt: in app/theme/ but not in app/theme/manifest.json: the manifest's folder holds only the vendored files, so move your own file out of it",
    ])
  })

  it.each(["../x.css", "/etc/x.css", "app/../../x.css", "app\\..\\x.css"])(
    "a pfad %s that leaves the repo",
    (pfad) => {
      write({ "app/theme/manifest.json": manifestOf({ [pfad]: TOKENS }) })
      expect(findings(["app/theme/manifest.json"])).toEqual([
        `app/theme/manifest.json: ${pfad} is not a repo-relative path: name the copy from the repo root, without a ".." segment`,
      ])
    },
  )

  it("a file in the manifest's folder that it does not list, also in a subfolder", () => {
    write({
      "app/theme/cd-tokens.generated.css": TOKENS,
      "app/theme/own.css": ".a { color: var(--cd-blau); }\n",
      "app/theme/extra/notes.md": "mine",
      "app/theme/.DS_Store": "finder",
      "app/theme/manifest.json": manifestOf({ "app/theme/cd-tokens.generated.css": TOKENS }),
    })
    const fix =
      "the manifest's folder holds only the vendored files, so move your own file out of it"
    expect(findings(["app/theme/manifest.json"]).sort()).toEqual([
      `app/theme/extra/notes.md: in app/theme/ but not in app/theme/manifest.json: ${fix}`,
      `app/theme/own.css: in app/theme/ but not in app/theme/manifest.json: ${fix}`,
    ])
  })

  it("one broken manifest does not stop the next one from being checked", () => {
    write({
      "app/a/manifest.json": "not json",
      "app/b/cd-tokens.generated.css": TOKENS,
      "app/b/manifest.json": manifestOf({ "app/b/cd-tokens.generated.css": TOKENS }),
    })
    expect(findings(["app/a/manifest.json", "app/b/manifest.json"])).toEqual([
      expect.stringMatching(/^app\/a\/manifest\.json: missing or not JSON/),
    ])
  })

  it("a scan root that does not exist is a finding, never an empty scan", () => {
    expect(findings([], ["gone"])).toEqual([
      "gone: scan root missing: point the drift guard at the folders that hold stylesheets",
    ])
  })
})

describe("vendoredTokenFindings: the palette rule", () => {
  const drifted =
    ':root {\n  --cd-blau: #1D1D1D;\n  --cd-ui-grund: #FFFFFF;\n}\n[data-cd-theme="dark"] {\n  --cd-gruen: #F9F7F7;\n}\n'

  it("a sanctioned copy that changes a palette value in :root fails, added tokens and other scopes do not", () => {
    write({
      "app/theme/cd-tokens.generated.css": drifted,
      "app/theme/manifest.json": manifestOf({ "app/theme/cd-tokens.generated.css": drifted }),
    })
    expect(findings(["app/theme/manifest.json"])).toEqual([
      "app/theme/cd-tokens.generated.css: --cd-blau is #1D1D1D, the toolkit's copy says #335DE5: vendor both from the same CI release (a toolkit bump or a re-vendor), never change a value in the repo",
    ])
  })

  it("a sanctioned copy outside the scan roots is still held to the palette", () => {
    write({
      "vendor/theme/cd-tokens.generated.css": drifted,
      "vendor/theme/manifest.json": manifestOf({ "vendor/theme/cd-tokens.generated.css": drifted }),
      "app/a.css": ".a {}\n",
    })
    expect(findings(["vendor/theme/manifest.json"])).toEqual([
      expect.stringMatching(/^vendor\/theme\/cd-tokens\.generated\.css: --cd-blau is #1D1D1D/),
    ])
  })
})

describe("rootTokens", () => {
  it("reads the --cd-* declarations of top-level :root blocks only", () => {
    const css = `@charset "UTF-8";
/* :root { --cd-kommentar: #000; } */
:root {
  --cd-blau: #335DE5;
  color: black;
  --cd-gradient: linear-gradient(
    120deg,
    #335DE5 30%,
    #00E676
  );
  & .nested { --cd-nested: #F9F7F7; & .deeper { --cd-deeper: #F9F7F7; } }
  --cd-gruen: #00E676
}
:root:not([data-cd-theme="dark"]) { --cd-not: #E6E2E2; }
:root .x { --cd-descendant: #8F8A8A; }
:root, :host { --cd-list: #6B6666; }
[data-cd-theme="dark"] { --cd-blau: #6B8AFF; }
@media screen { :root { --cd-media: #CD1839; } }
:root { --cd-blau: #2B50D4; }
`
    expect(Object.fromEntries(rootTokens(css))).toEqual({
      "--cd-blau": "#2B50D4",
      "--cd-gradient": "linear-gradient( 120deg, #335DE5 30%, #00E676 )",
      "--cd-gruen": "#00E676",
    })
  })

  it("survives a stray closing brace and yields nothing without a :root block", () => {
    expect(rootTokens("} .a { --cd-blau: red; }").size).toBe(0)
    expect(rootTokens("").size).toBe(0)
  })
})

function forkFix(): string {
  return "reference the toolkit's tokens and roles with var(), or vendor the CI file unchanged with a manifest listed in SANCTIONED_TOKEN_MANIFESTS"
}
