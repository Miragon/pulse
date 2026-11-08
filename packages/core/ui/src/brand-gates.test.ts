import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { UI_MESSAGES } from "./locale/ui-messages.js"
import {
  BARE_PAUSE_RULE_EN,
  catalogTextFindings,
  colorFindings,
  glossaryFindings,
  glyphFindings,
  iconSizeFindings,
  PRODUCT_GLOSSARY,
  scanColors,
  scanGlyphs,
  scanIconSizes,
  scanTypeScale,
  typeScaleFindings,
} from "./testing/index.js"

/** The brand gates over the kit's own sources: the gates the kit ships run on the kit first. */

const SRC = fileURLToPath(new URL(".", import.meta.url))
/** Every source directory but the gates themselves (testing) and the vendored tokens. */
const SCANNED = ["components", "hooks", "kit", "lib", "locale", "primitives", "theme", "tones"]

/**
 * The shadcn primitives as vendored in toolkit 2.8.1 take Tailwind's own sizes (`text-sm`,
 * `text-base`). Shrink-only: a primitive moved onto the type scale fails until its entry goes.
 */
const PRIMITIVE_OFF_SCALE = [
  "alert.tsx text-sm",
  "alert.tsx text-sm",
  "button.tsx text-sm",
  "card.tsx card:text-sm",
  "card.tsx text-base",
  "card.tsx text-sm",
  "card.tsx text-sm",
  "dialog.tsx text-sm",
  "input.tsx file:text-sm",
  "input.tsx md:text-sm",
  "input.tsx text-base",
  "table.tsx text-sm",
  "table.tsx text-sm",
  "tabs.tsx text-sm",
]

/** The sources at the root of src (the barrel and the render fixtures), tests aside. */
const ROOT_FILES = readdirSync(SRC, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
  .map((entry) => entry.name)
  .filter((name) => !/\.(test|spec|d)\.tsx?$/.test(name))
  .sort()

describe("the gates reach every source", () => {
  it("scans every directory of src but testing and tokens", () => {
    const dirs = readdirSync(SRC, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== "testing" && name !== "tokens")
      .sort()
    expect(dirs).toEqual(SCANNED)
  })

  it("scans the files at the root of src too (they compile into dist/ like the rest)", () => {
    expect(ROOT_FILES).toEqual(expect.arrayContaining(["index.ts", "render-cases.tsx"]))
  })

  it.each(ROOT_FILES)("src/%s passes the glyph, icon-size, type-scale and colour gates", (name) => {
    const source = readFileSync(join(SRC, name), "utf8")
    expect([
      ...glyphFindings(source, name),
      ...iconSizeFindings(source, name),
      ...typeScaleFindings(source, name),
      ...colorFindings(source, name),
    ]).toEqual([])
  })
})

/** brand-lint reads Markdown only, not strings in `.ts`/`.tsx`. */
describe("kit copy follows the voice rules", () => {
  const SECTIONS = ["common", "listFooter", "filterBar", "pills"] as const
  it.each(
    (["de", "en"] as const).flatMap((language) =>
      SECTIONS.map((section) => [`${section} (${language})`, section, language] as const),
    ),
  )("%s", (_, section, language) => {
    expect(catalogTextFindings(UI_MESSAGES[language][section], { language })).toEqual([])
  })

  it.each(["de", "en"] as const)("uses the product's words (%s)", (language) => {
    // The kit's views pause nothing of their own: any "pause" means the engine's suspension.
    const rules = { de: PRODUCT_GLOSSARY.de, en: [...PRODUCT_GLOSSARY.en, BARE_PAUSE_RULE_EN] }
    expect(glossaryFindings(UI_MESSAGES[language], rules[language])).toEqual([])
  })
})

describe.each(SCANNED)("src/%s", (dir) => {
  const path = join(SRC, dir)

  it("draws icons with Lucide, never glyphs or emoji", () => {
    expect(scanGlyphs(path)).toEqual([])
  })

  it("draws icons at the CI sizes (16 or 24 px)", () => {
    expect(scanIconSizes(path)).toEqual([])
  })

  it("sets text on the type scale (the shadcn primitives' Tailwind sizes pinned)", () => {
    const findings = scanTypeScale(path).map((f) => `${f.file} ${f.match}`)
    expect(findings.sort()).toEqual(dir === "primitives" ? PRIMITIVE_OFF_SCALE : [])
  })

  it("colours through role names only, outside the reasoned allowances", () => {
    // Shrink-only: a file that loses its raw colours fails here until its entry goes.
    const allow: Record<string, Record<string, string>> = {
      theme: {
        "cd-tokens.ts":
          "CD_TOKENS mirrors the vendored token file for TS consumers (the BPMN canvas); cd-tokens.test.ts pins it value by value",
      },
      kit: {
        "komet-svg.ts":
          "the CI's Komet icon, vendored byte for byte (modeler-tool-design §11), sha-pinned in brand-mark.test.tsx",
      },
    }
    expect(scanColors(path, { allow: allow[dir] })).toEqual([])
  })
})
