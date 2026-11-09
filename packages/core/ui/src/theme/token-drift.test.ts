/// <reference types="node" />
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { themeStylesheets } from "../testing/contrast.js"
import { rootTokens, scopedTokens, vendoredTokenFindings } from "./vendored-tokens.test-support.js"

/**
 * Drift guard (modeler-tool-design §13: vendor the CI tokens unchanged, never
 * fork a value). The token file every view ships is pulse-ui's vendored copy
 * (`packages/core/ui/src/tokens/`): its `theme.css` imports it. A `--cd-*` is
 * declared only in a vendored copy that a manifest in
 * SANCTIONED_TOKEN_MANIFESTS lists: inside that manifest's folder, byte-equal
 * to the manifest's sha256, nothing else in the folder, and, once the
 * manifest's stylesheets declare a `--cd-*` at all, their top-level `:root`
 * blocks together declaring every token of pulse-ui's copy. Token equality
 * holds over all sanctioned copies: a token two copies declare in the same
 * scope (`:root`, the light or the dark theme) has one value, in `:root`
 * pulse-ui's (`vendored-tokens.test-support.ts`). The scan reads every stylesheet of the
 * repo's apps, packages, templates and docs. Besides pulse-ui's copy that is
 * the Miragon docs kit (`docs/.vitepress/miragon/`, vendored from
 * Miragon/corporate-identity, skill docs-site): its token file, theme and
 * logos are pinned by the kit's own manifest, which `check.mjs` verifies as
 * well; the kit's contrast and role mapping are tested at its source.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../../../..")

/** The Miragon docs kit, vendored from Miragon/corporate-identity with its own manifest. */
const DOCS_KIT = "docs/.vitepress/miragon"

/**
 * The vendored CI token copies, by manifest (the docs kit's format:
 * `version`, `dateien: [{ pfad, quelle, sha256 }]`). A copy is sanctioned only
 * by an entry here, never by a manifest's mere presence next to it. A second
 * copy (say the App and web variant of the token file from
 * modeler-tool-design) lands with its manifest and adds that manifest's path
 * here; it never becomes an exception in the scan.
 */
const SANCTIONED_TOKEN_MANIFESTS = [
  // pulse-ui's copy, the token file every view ships (its theme.css imports it).
  "packages/core/ui/src/tokens/manifest.json",
  `${DOCS_KIT}/manifest.json`,
  // The VS Code webview (apps/vscode): the App and web variant of modeler-tool-design.
  "packages/core/runtime-view/src/webview/theme/manifest.json",
]

/** Where a `--cd-*` declaration outside a sanctioned copy is a fork. */
const TOKEN_SCAN_ROOTS = ["apps", "packages", "templates", "docs"]

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const uiTheme = read("../theme.css")
const uiTokens = read("../tokens/cd-tokens.generated.css")

describe("Miragon tokens: vendored copies listed by manifest", () => {
  it("the shipped theme imports pulse-ui's vendored token file", () => {
    expect(uiTheme).toContain('@import "./tokens/cd-tokens.generated.css";')
    // Every consumer's contrast check reads these two files: theme.css and the tokens it imports.
    expect(themeStylesheets()).toEqual([uiTokens, uiTheme])
  })

  it("the docs site vendors the Miragon docs kit unchanged (check.mjs)", () => {
    const check = spawnSync(process.execPath, [join(REPO_ROOT, DOCS_KIT, "check.mjs")], {
      encoding: "utf8",
    })
    expect(check.stderr, "re-vendor the kit, see the docs-site skill").toBe("")
    expect(check.status).toBe(0)
  })

  it("the equality rule compares real values: the VS Code webview's copy and the docs kit share tokens in :root, the light and the dark theme", () => {
    const shared = (a: string, b: string) => {
      const left = scopedTokens(readFileSync(join(REPO_ROOT, a), "utf8"))
      const right = scopedTokens(readFileSync(join(REPO_ROOT, b), "utf8"))
      return [...left]
        .filter(([scope, tokens]) => [...tokens.keys()].some((name) => right.get(scope)?.has(name)))
        .map(([scope]) => scope)
    }
    expect(
      shared(
        "packages/core/runtime-view/src/webview/theme/cd-tokens.generated.css",
        `${DOCS_KIT}/theme/cd-tokens.generated.css`,
      ),
    ).toEqual(
      expect.arrayContaining([
        ":root",
        '[data-cd-theme="light"]',
        '@media screen { [data-cd-theme="dark"] }',
      ]),
    )
  })

  it("a --cd-* token is declared only in a sanctioned vendored copy, byte-equal to its manifest, on pulse-ui's palette and with one value per scope in every copy (no fork)", () => {
    const palette = rootTokens(uiTokens)
    // The palette rule is not blind: pulse-ui's copy yields its palette, and
    // the docs kit's copy declares every token of it (vendoredTokenFindings
    // requires that too), so each value is compared.
    expect(palette.get("--cd-blau")).toMatch(/^#[0-9A-Fa-f]{6}$/)
    const kitTokens = rootTokens(
      readFileSync(join(REPO_ROOT, DOCS_KIT, "theme", "cd-tokens.generated.css"), "utf8"),
    )
    expect([...palette.keys()].filter((name) => !kitTokens.has(name))).toEqual([])
    expect(
      vendoredTokenFindings({
        root: REPO_ROOT,
        manifests: SANCTIONED_TOKEN_MANIFESTS,
        scanRoots: TOKEN_SCAN_ROOTS,
        palette,
      }),
    ).toEqual([])
  })
})
