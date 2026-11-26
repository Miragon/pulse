/// <reference types="node" />
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { themeStylesheets } from "../testing/contrast.js"
import { rootTokens, scopedTokens, vendoredTokenFindings } from "./vendored-tokens.test-support.js"

/**
 * Drift guard (modeler-tool-design §13: vendor the CI tokens unchanged, never
 * fork a value). The token file every view ships is pulse-ui's vendored copy
 * (`packages/core/ui/src/tokens/`): its `theme.css` imports it. A `--cd-*` is
 * declared only in a vendored copy that a manifest in
 * SANCTIONED_TOKEN_MANIFESTS lists: inside that manifest's folder (for
 * `.miragon/brand-assets.sha256`, the copy's own folder), byte-equal to the
 * listed sha256, nothing else in the folder, and, once the copies of a folder
 * declare a `--cd-*` at all, their top-level `:root` blocks together declaring
 * every token of pulse-ui's copy. Token equality holds over all sanctioned
 * copies: a token two copies declare in the same scope (`:root`, the light or
 * the dark theme) has one value, in `:root` pulse-ui's
 * (`vendored-tokens.test-support.ts`). The scan reads every stylesheet of the
 * repo's apps, packages, templates and docs (installs skipped). The Miragon
 * docs kit is no copy: the docs site installs it as `@miragon/docs-starter`,
 * whose contrast and role mapping are tested at its source. The kit may ship an
 * older token release than pulse-ui, so it need not declare every token, but
 * each token it declares keeps pulse-ui's value in that scope.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../../../..")

/** The token file of the Miragon docs kit, as the docs site installs it. */
const DOCS_KIT_TOKENS = join(
  dirname(
    createRequire(join(REPO_ROOT, "docs/package.json")).resolve(
      "@miragon/docs-starter/package.json",
    ),
  ),
  "theme/cd-tokens.generated.css",
)

/**
 * The vendored CI token copies, by manifest: the sha256sum list that
 * `brand-assets.mjs` writes for the copies in `.miragon/brand-assets.yaml`
 * (pulse-ui's token file every view ships, the runtime view's webview included,
 * and the canvas and JSON of that webview, packages/core/runtime-view, which
 * Pulse for VS Code and Pulse for Orca host). A copy is sanctioned only by an entry here,
 * never by a manifest's mere presence next to it. A new copy is added with
 * `brand-assets.mjs --add`; it never becomes an exception in the scan.
 */
const SANCTIONED_TOKEN_MANIFESTS = [".miragon/brand-assets.sha256"]

/** Where a `--cd-*` declaration outside a sanctioned copy is a fork. */
const TOKEN_SCAN_ROOTS = ["apps", "packages", "templates", "docs"]

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const uiTheme = read("../theme.css")
const uiTokens = read("../tokens/cd-tokens.generated.css")
const kitTokens = readFileSync(DOCS_KIT_TOKENS, "utf8")

/**
 * The fork check reads every stylesheet and source under apps, packages, templates and docs: 0.2 s
 * alone, up to 2.3 s while `pnpm test` runs every package's suite at once.
 */
const SCAN = { timeout: 30_000 }

describe("Miragon tokens: vendored copies listed by manifest", SCAN, () => {
  it("the shipped theme imports pulse-ui's vendored token file", () => {
    expect(uiTheme).toContain('@import "./tokens/cd-tokens.generated.css";')
    // Every consumer's contrast check reads these two files: theme.css and the tokens it imports.
    expect(themeStylesheets()).toEqual([uiTokens, uiTheme])
  })

  it("the docs kit (@miragon/docs-starter) gives each token it shares with pulse-ui's copy the same value, in :root, the light and the dark theme", () => {
    const ui = scopedTokens(uiTokens)
    const kit = scopedTokens(kitTokens)
    const sharedScopes = [...ui]
      .filter(([scope, tokens]) => [...tokens.keys()].some((name) => kit.get(scope)?.has(name)))
      .map(([scope]) => scope)
    expect(sharedScopes).toEqual(
      expect.arrayContaining([
        ":root",
        '[data-cd-theme="light"]',
        '@media screen { [data-cd-theme="dark"] }',
      ]),
    )
    const differing = [...kit].flatMap(([scope, tokens]) =>
      [...tokens]
        .filter(([name, value]) => ui.get(scope)?.has(name) && ui.get(scope)?.get(name) !== value)
        .map(
          ([name, value]) =>
            `${name} in ${scope}: ${value} in the kit, ${ui.get(scope)?.get(name)} in pulse-ui`,
        ),
    )
    expect(
      differing,
      "bump @miragon/docs-starter in docs/ to the kit on pulse-ui's token release",
    ).toEqual([])
  })

  it("a --cd-* token is declared only in a sanctioned vendored copy, byte-equal to its manifest, on pulse-ui's palette and with one value per scope in every copy (no fork)", () => {
    const palette = rootTokens(uiTokens)
    // The palette rule is not blind: pulse-ui's copy yields its palette, and
    // every token the docs kit declares is on it.
    expect(palette.get("--cd-blau")).toMatch(/^#[0-9A-Fa-f]{6}$/)
    const kitPalette = rootTokens(kitTokens)
    expect(kitPalette.get("--cd-blau")).toBe(palette.get("--cd-blau"))
    expect([...kitPalette.keys()].filter((name) => !palette.has(name))).toEqual([])
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
