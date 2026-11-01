import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  contrastFindings,
  parseThemeVariables,
  ROLE_CONTRAST_PAIRS,
  stylesheetColorFindings,
  toneContrastPairs,
  themeStylesheets,
} from "@miragon/pulse-ui/testing"
import { rootTokens, vendoredTokenFindings } from "./vendored-tokens.js"

/**
 * The stylesheets every view document inlines: the app's own and the customer
 * template's (its globals.css plus brand.css, where a customer sets the brand).
 * Both build on pulse-ui's Miragon theme (`@miragon/pulse-ui/theme.css`: the
 * vendored `--cd-*` tokens plus the role layer, light and dark) and may only
 * override ROLE variables on top. Pinned here at the
 * source (test:host re-checks the BUILT bundle):
 *  - no `min-height` floor on html/body/#root (#339): auto-resize measures
 *    the document, so every inline view was at least 600 px tall in the chat;
 *  - no forced font: no `font-family … !important` (it beats the host's font
 *    and every `font-mono`), no inlined Geist (`fonts.css` / `@fontsource`:
 *    base64 in every view document; Geist arrives by URL from the server's
 *    font route, `declareServedFonts` in `HostDocument`, never inlined);
 *  - no raw colour and no `--cd-*` or retired `--m-*`/`--critical` variable in
 *    a consumer stylesheet: the tokens are pulse-ui's, vendored once;
 *  - the tone and role pairs at WCAG AA in light AND dark over what ships.
 */

/** The Miragon docs kit, vendored from Miragon/corporate-identity with its own manifest. */
const DOCS_KIT = "docs/.vitepress/miragon"

/**
 * The vendored CI token copies, by manifest (the docs kit's format:
 * `version`, `dateien: [{ pfad, quelle, sha256 }]`). A copy is
 * sanctioned only by an entry here, never by a manifest's mere presence next
 * to it. A second copy (say the App and web variant of the token file from
 * modeler-tool-design) lands with its manifest and adds that manifest's path
 * here; it never becomes an exception in the scan.
 */
const SANCTIONED_TOKEN_MANIFESTS = [
  // pulse-ui's copy, the token file every view ships (its theme.css imports it).
  "packages/core/ui/src/tokens/manifest.json",
  `${DOCS_KIT}/manifest.json`,
  // The VS Code webview (apps/vscode): the App and web variant of modeler-tool-design.
  "apps/vscode/src/webview/theme/manifest.json",
]

/** Where a `--cd-*` declaration outside a sanctioned copy is a fork. */
const TOKEN_SCAN_ROOTS = ["apps", "packages", "templates", "docs"]

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8")

const STYLESHEETS = {
  app: read("../src/ui/globals.css"),
  template: read("../../../templates/composed-server/server/src/ui/globals.css"),
  templateBrand: read("../../../templates/composed-server/server/src/ui/brand.css"),
}

/** Each consumer's stack on top of pulse-ui's theme, as the browser applies it. */
const SHIPPED = {
  app: [STYLESHEETS.app],
  template: [STYLESHEETS.template, STYLESHEETS.templateBrand],
}

/** Rules only: a comment may name what it forbids. */
const rulesOf = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "")

/** Every rule block whose selector list targets html, body or #root. */
function documentRules(css: string): string[] {
  return [...rulesOf(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.split(",").some((s) => /^\s*(html|body|#root)\s*$/.test(s)))
    .map(([rule]) => rule)
}

const kit = themeStylesheets()

/**
 * The CI's own exemption (modeler-tool-design §3.3, mirrored by pulse-ui's
 * theme tests): success green and amber as a dot, edge or
 * icon on a light ground reach only 1.67:1 / 1.83:1, so a status never stands
 * alone. Everything else must pass.
 */
const LIGHT_STATUS_EXEMPTION = ["success", "warning"]
  .flatMap((tone) => [
    ...["on card", "on background"].flatMap((surface) =>
      ["DOT", "ICON", "BORDER"].map((role) => `light: TONE_${role}.${tone} ${surface}`),
    ),
    `light: TONE_DOT.${tone} inside its tint`,
    `light: TONE_ICON.${tone} inside its tint`,
  ])
  .sort()

describe("view stylesheets (#339)", () => {
  it.each(Object.entries(STYLESHEETS))("%s: puts no height floor on html/body/#root", (_, css) => {
    for (const rule of documentRules(css)) expect(rule).not.toMatch(/min-height/)
  })

  it.each(Object.entries(STYLESHEETS))("%s: forces no font and inlines none", (_, css) => {
    const rules = rulesOf(css)
    expect(rules).not.toMatch(/font-family[^;}]*!important/)
    expect(rules).not.toMatch(/@fontsource|pulse-ui\/fonts\.css|@font-face/)
  })

  it("the app builds on pulse-ui's Miragon theme after Tailwind, never its globals.css", () => {
    const rules = rulesOf(STYLESHEETS.app)
    const tailwind = rules.indexOf('@import "tailwindcss"')
    const theme = rules.indexOf('@import "@miragon/pulse-ui/theme.css"')
    expect(tailwind).toBe(0)
    expect(theme).toBeGreaterThan(tailwind)
    expect(rules).not.toContain("@miragon/pulse-ui/globals.css")
    // The theme cannot know where the kit lives: the consumer scans its
    // components (Card, Skeleton, the kit pieces …) itself. The app reads the
    // workspace sources, where the brand gates' fixtures sit in src/testing.
    expect(rules).toMatch(/@source "[^"]*packages\/core\/ui\/src"/)
    expect(rules).toMatch(/@source not "[^"]*packages\/core\/ui\/src\/testing"/)
  })

  it("the template builds on pulse-ui's Miragon theme through brand.css", () => {
    const globals = rulesOf(STYLESHEETS.template)
    expect(globals.indexOf('@import "tailwindcss"')).toBe(0)
    expect(globals).toContain('@import "./brand.css"')
    expect(globals).not.toContain("@miragon/pulse-ui/globals.css")
    // The tarball's dist carries no tests (pulse-ui's package.json `files`), so the
    // template scans it whole: no fixture class reaches the customer's stylesheet.
    expect(globals).toMatch(/@source "[^"]*node_modules\/@miragon\/pulse-ui\/dist"/)
    expect(globals).not.toMatch(/@source not/)
    expect(rulesOf(STYLESHEETS.templateBrand)).toContain('@import "@miragon/pulse-ui/theme.css"')
  })
})

describe("view stylesheets: role variables over the Miragon theme", () => {
  it.each(Object.entries(STYLESHEETS))("%s: names no raw colour in its rules", (file, css) => {
    expect(stylesheetColorFindings(css, file)).toEqual([])
  })

  it.each(Object.entries(STYLESHEETS))(
    "%s: declares no --cd-* token and no retired accent (--m-*, --critical)",
    (_, css) => {
      expect(rulesOf(css)).not.toMatch(/--cd-[\w-]+\s*:/)
      expect(rulesOf(css)).not.toMatch(/--(color-)?(m-(blue|green)|critical)[\w-]*\s*:/)
    },
  )

  it.each(Object.entries(SHIPPED))(
    "%s: every TONE_* pair reaches AA in light and dark (apart from the CI's status exemption)",
    (_, stack) => {
      const theme = parseThemeVariables(...kit, ...stack)
      expect(contrastFindings(theme, toneContrastPairs()).sort()).toEqual(LIGHT_STATUS_EXEMPTION)
    },
  )

  it.each(Object.entries(SHIPPED))(
    "%s: text, each foreground on its fill, links, focus rings and field edges reach AA in light and dark",
    (_, stack) => {
      const theme = parseThemeVariables(...kit, ...stack)
      expect(contrastFindings(theme, ROLE_CONTRAST_PAIRS)).toEqual([])
    },
  )
})

/**
 * Drift guard (modeler-tool-design §13: vendor the CI tokens unchanged, never
 * fork a value). The token file every view ships is pulse-ui's vendored copy
 * (`packages/core/ui/src/tokens/`): its `theme.css` imports it. A `--cd-*` is
 * declared only in a vendored copy that a manifest in
 * SANCTIONED_TOKEN_MANIFESTS lists: inside that manifest's folder, byte-equal
 * to the manifest's sha256, nothing else in the folder, and, once the
 * manifest's stylesheets declare a `--cd-*` at all, their top-level `:root`
 * blocks together declaring every token of pulse-ui's copy with its value
 * (`vendored-tokens.ts`). Besides pulse-ui's copy that is the Miragon docs kit (`docs/.vitepress/miragon/`, vendored from
 * Miragon/corporate-identity, skill docs-site): its token file, theme and
 * logos are pinned by the kit's own manifest, which `check.mjs` verifies as
 * well; the kit's contrast and role mapping are tested at its source.
 */
describe("Miragon tokens: vendored copies listed by manifest", () => {
  const require = createRequire(import.meta.url)
  const uiTheme = require.resolve("@miragon/pulse-ui/theme.css")
  const uiTokens = readFileSync(
    require.resolve("@miragon/pulse-ui/cd-tokens.generated.css"),
    "utf8",
  )

  it("the shipped theme imports pulse-ui's vendored token file", () => {
    expect(readFileSync(uiTheme, "utf8")).toContain('@import "./tokens/cd-tokens.generated.css";')
    expect(kit).toEqual([uiTokens, readFileSync(uiTheme, "utf8")])
  })

  it("the docs site vendors the Miragon docs kit unchanged (check.mjs)", () => {
    const repo = fileURLToPath(new URL("../../../", import.meta.url))
    const check = spawnSync(process.execPath, [join(repo, DOCS_KIT, "check.mjs")], {
      encoding: "utf8",
    })
    expect(check.stderr, "re-vendor the kit, see the docs-site skill").toBe("")
    expect(check.status).toBe(0)
  })

  it("a --cd-* token is declared only in a sanctioned vendored copy, byte-equal to its manifest and on pulse-ui's palette (no fork)", () => {
    const repo = fileURLToPath(new URL("../../../", import.meta.url))
    const palette = rootTokens(uiTokens)
    // The palette rule is not blind: pulse-ui's copy yields its palette, and
    // the docs kit's copy declares every token of it (vendoredTokenFindings
    // requires that too), so each value is compared.
    expect(palette.get("--cd-blau")).toMatch(/^#[0-9A-Fa-f]{6}$/)
    const kitTokens = rootTokens(
      readFileSync(join(repo, DOCS_KIT, "theme", "cd-tokens.generated.css"), "utf8"),
    )
    expect([...palette.keys()].filter((name) => !kitTokens.has(name))).toEqual([])
    expect(
      vendoredTokenFindings({
        root: repo,
        manifests: SANCTIONED_TOKEN_MANIFESTS,
        scanRoots: TOKEN_SCAN_ROOTS,
        palette,
      }),
    ).toEqual([])
  })
})
