import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  formatDuration,
  formatPercentPoints,
  formatPeriod,
  formatRelativeTime,
  setFormatLocale,
} from "./format/index.js"
import { UI_MESSAGES } from "./locale/ui-messages.js"
import {
  BARE_PAUSE_RULE_EN,
  catalogTextFindings,
  colorFindings,
  glossaryFindings,
  glyphFindings,
  iconSizeFindings,
  outlineFindings,
  PRODUCT_GLOSSARY,
  scanColors,
  scanGlyphs,
  scanIconSizes,
  scanOutlines,
  scanTypeScale,
  typeScaleFindings,
} from "./testing/index.js"

/** The brand gates over the kit's own sources: the gates the kit ships run on the kit first. */

const SRC = fileURLToPath(new URL(".", import.meta.url))
/** Every source directory but the gates themselves (testing) and the vendored tokens. */
const SCANNED = [
  "components",
  "format",
  "hooks",
  "kit",
  "lib",
  "locale",
  "primitives",
  "theme",
  "tones",
]

/**
 * The density section's named deviation (root CLAUDE.md): 12 px icons beside dense text and on
 * 20 px badges, per directory and file, each with its reason. Shrink-only: a listed file that
 * draws no 12 px icon fails as an unused allowance.
 */
const DENSE_ICONS_ALLOWED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  components: {
    "CountBadge.tsx": "an alarming count's tone icon inside its 20 px pill beside 13 px figures",
    "DrillButton.tsx": "the xs drill of a table row is the 24 px xs button, its arrow 12 px",
  },
  primitives: {
    "badge.tsx": "a badge is 20 px high beside 13 px text, so its icon is 12 px ([&>svg]:size-3!)",
    "button.tsx":
      "the xs and icon-xs buttons are 24 px (in notice strips, to copy, in table rows), so their icon is 12 px",
  },
  kit: {
    "icon.tsx": "Icon's dense is the deviation's 12 px icon itself",
    "segmented-control.tsx": "an alarming count's tone icon beside 13 px text in a 24 px segment",
    "table.tsx": "a column head's sort arrow beside its 13 px caption",
  },
}

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

  it.each(ROOT_FILES)(
    "src/%s passes the glyph, icon-size, type-scale, colour and outline gates",
    (name) => {
      const source = readFileSync(join(SRC, name), "utf8")
      expect([
        ...glyphFindings(source, name),
        ...iconSizeFindings(source, name),
        ...typeScaleFindings(source, name),
        ...colorFindings(source, name),
        ...outlineFindings(source, name),
      ]).toEqual([])
    },
  )
})

/** brand-lint reads Markdown only, not strings in `.ts`/`.tsx`. */
describe("kit copy follows the voice rules", () => {
  const SECTIONS = [
    "common",
    "listFooter",
    "filterBar",
    "searchField",
    "viewBar",
    "copyableId",
    "conditionChip",
    "stateLabel",
    "pills",
  ] as const
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

/**
 * The formatters write a few words of their own (relative times under a minute, the units of a
 * duration, a period and percentage points): rendered in each language, they meet the catalog
 * gates the kit's catalogs meet.
 */
describe("the formatters' own words follow the voice rules", () => {
  const LOCALES = { de: "de-DE", en: "en-US" } as const
  const NOW = new Date("2026-10-21T12:00:00Z")
  const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString()

  afterEach(() => {
    setFormatLocale(undefined)
  })

  it.each(["de", "en"] as const)("%s", (language) => {
    setFormatLocale({ language, locale: LOCALES[language] })
    const words = {
      justNow: formatRelativeTime(at(-20_000), NOW),
      underAMinute: formatRelativeTime(at(20_000), NOW),
      minutesAgo: formatRelativeTime(at(-5 * 60_000), NOW),
      seconds: formatDuration(12_000),
      minutes: formatDuration(187_000),
      hours: formatDuration(5_040_000),
      days: formatDuration(97_200_000),
      period: formatPeriod("7d"),
      onePeriod: formatPeriod("1h"),
      percentPoints: formatPercentPoints(0.2),
    }
    expect(catalogTextFindings(words, { language })).toEqual([])
    expect(glossaryFindings(words, PRODUCT_GLOSSARY[language])).toEqual([])
  })
})

describe.each(SCANNED)("src/%s", (dir) => {
  const path = join(SRC, dir)

  it("draws icons with Lucide, never glyphs or emoji", () => {
    expect(scanGlyphs(path)).toEqual([])
  })

  it("draws icons at the CI sizes (16 or 24 px), at 12 px only in the files the dense deviation names", () => {
    expect(scanIconSizes(path, { allowDense: DENSE_ICONS_ALLOWED[dir] })).toEqual([])
  })

  it("sets text on the type scale and its three weights, the vendored shadcn primitives included", () => {
    expect(scanTypeScale(path).map((f) => `${f.file}:${f.line} ${f.match}`)).toEqual([])
  })

  it("draws no outline at rest under forced colours: outline-hidden only under a focus state", () => {
    expect(scanOutlines(path)).toEqual([])
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
