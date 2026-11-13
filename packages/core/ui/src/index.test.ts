import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as format from "./format/index.js"
import * as ui from "./index.js"
import * as testing from "./testing/index.js"
import * as tones from "./tones/index.js"

/**
 * The published entries' lists: knip never reports what an entry exports, so a name added or
 * dropped is held here and decided in review. Types are erased at runtime: these are the runtime
 * names. A piece missing from the root entry is a piece no view can import.
 */
describe("the @miragon/pulse-ui entry", () => {
  it("exports exactly these runtime names", () => {
    expect(Object.keys(ui).sort()).toEqual([
      "Alert",
      "AlertDescription",
      "AlertTitle",
      "AppEmptyState",
      "Badge",
      "Button",
      "CD_TOKENS",
      "CD_TOKENS_VERSION",
      "Card",
      "CardAction",
      "CardContent",
      "CardDescription",
      "CardFooter",
      "CardHeader",
      "CardTitle",
      "CountPill",
      "Dialog",
      "DialogClose",
      "DialogContent",
      "DialogDescription",
      "DialogFooter",
      "DialogHeader",
      "DialogOverlay",
      "DialogPortal",
      "DialogTitle",
      "DialogTrigger",
      "DrillButton",
      "EmptyState",
      "ErrorState",
      "FOCUS_RING",
      "FOCUS_RING_INSET",
      "FilterBar",
      "GEIST_FONT_FILES",
      "GroupCard",
      "HOST_FONT_VARIABLES",
      "ICON_STROKE",
      "Icon",
      "Input",
      "KometMark",
      "KpiGrid",
      "KpiGridSkeleton",
      "LOG_TEXT_PREVIEW",
      "ListFooter",
      "LivePill",
      "LocaleProvider",
      "LogText",
      "MENU_ITEM",
      "MICRO_LABEL",
      "NamedId",
      "NativeSelect",
      "NavigationFocus",
      "PagedListFooter",
      "ROLE_TOKENS",
      "RowCard",
      "SITUATION_TONES",
      "Section",
      "SectionHeading",
      "SegmentedControl",
      "Skeleton",
      "StatusBadge",
      "Switch",
      "TEXT_BLOCK_FRAME",
      "TONE_ALIASES",
      "TONE_BORDER",
      "TONE_DOT",
      "TONE_ICON",
      "TONE_INK",
      "TONE_SOFT",
      "TONE_TINT",
      "TONE_VARIANTS",
      "TYPE_FLOOR_PX",
      "TYPE_SCALE",
      "TYPE_STEPS",
      "Table",
      "TableBody",
      "TableCaption",
      "TableCell",
      "TableEmptyState",
      "TableFooter",
      "TableHead",
      "TableHeader",
      "TableRow",
      "Tabs",
      "TabsContent",
      "TabsList",
      "TabsTrigger",
      "Td",
      "Th",
      "ToastProvider",
      "UI_MESSAGES",
      "VersionChip",
      "WidgetHeader",
      "adoptHostFontVariables",
      "badgeVariants",
      "buttonVariants",
      "cn",
      "countTone",
      "createUseT",
      "fontFaces",
      "formatClock",
      "formatCompactCount",
      "formatCount",
      "formatDate",
      "formatDuration",
      "formatInstant",
      "formatNumber",
      "formatPercent",
      "formatPercentPoints",
      "formatPeriod",
      "formatRelativeTime",
      "formatTime",
      "formatTimestamp",
      "getFormatLocale",
      "isToneVariant",
      "resolveTone",
      "resolveUiMessages",
      "setFormatLocale",
      "severityTone",
      "shortId",
      "subscribeFormatLocale",
      "truncate",
      "useDebouncedValue",
      "useLocale",
      "usePortalContainer",
      "useResetOnChange",
      "useToast",
      "useTranslate",
      "useUiMessages",
    ])
  })

  it("keeps the internals internal", () => {
    for (const name of [
      "BreakableId",
      "FIELD_CONTROL",
      "PortalContainerContext",
      // No consumer outside the kit: Icon's `dense`, KometMark's own clamp, ListFooter's count.
      "DENSE_ICON_STROKE",
      "KOMET_MIN_SIZE",
      "formatCountIn",
    ]) {
      expect(ui, name).not.toHaveProperty(name)
    }
  })
})

/**
 * `./tones` is the framework-free part of the tone model, for a UI that loads no React (the VS
 * Code webview): the same bindings as the root, name by name, so no tone has two sources.
 */
describe("the @miragon/pulse-ui/tones entry", () => {
  it("exports exactly these runtime names", () => {
    expect(Object.keys(tones).sort()).toEqual([
      "SITUATION_TONES",
      "TONE_ALIASES",
      "TONE_VARIANTS",
      "countTone",
      "isToneVariant",
      "resolveTone",
      "severityTone",
    ])
  })

  it("hands out the root's own bindings", () => {
    for (const [name, value] of Object.entries(tones)) {
      expect(ui[name as keyof typeof ui], name).toBe(value)
    }
  })
})

/**
 * `./format` holds the formatters for a UI that loads no React (the VS Code webview and the
 * extension's core): the same bindings as the root, so a date or a count has one source.
 */
describe("the @miragon/pulse-ui/format entry", () => {
  it("exports exactly these runtime names", () => {
    expect(Object.keys(format).sort()).toEqual([
      "formatClock",
      "formatCompactCount",
      "formatCount",
      "formatDate",
      "formatDuration",
      "formatInstant",
      "formatNumber",
      "formatPercent",
      "formatPercentPoints",
      "formatPeriod",
      "formatRelativeTime",
      "formatTime",
      "formatTimestamp",
      "getFormatLocale",
      "setFormatLocale",
      "shortId",
      "subscribeFormatLocale",
      "truncate",
    ])
  })

  it("hands out the root's own bindings", () => {
    for (const [name, value] of Object.entries(format)) {
      expect(ui[name as keyof typeof ui], name).toBe(value)
    }
  })
})

/**
 * `./testing` holds the brand gates and the product's words every Pulse UI runs in its own test
 * suite (Node, never bundled).
 */
describe("the @miragon/pulse-ui/testing entry", () => {
  it("exports exactly these runtime names", () => {
    expect(Object.keys(testing).sort()).toEqual([
      "BARE_PAUSE_RULE_EN",
      "CI_ICON_SIZES",
      "COUNT_TERMS",
      "DENSE_ICON_SIZE",
      "FORBIDDEN_GLYPHS",
      "LIGHT_STATUS_EXEMPTION",
      "PRODUCT_GLOSSARY",
      "ROLE_CONTRAST_PAIRS",
      "blindGlossaryRules",
      "catalogTextFindings",
      "colorFindings",
      "composite",
      "contrastFindings",
      "contrastRatio",
      "glossaryFindings",
      "glyphFindings",
      "iconSizeFindings",
      "measureContrast",
      "parseThemeVariables",
      "resolveColor",
      "scanColors",
      "scanGlyphs",
      "scanIconSizes",
      "scanTypeScale",
      "sourceTexts",
      "stylesheetColorFindings",
      "stylesheetRules",
      "stylesheetShapeFindings",
      "themeStylesheets",
      "toneContrastPairs",
      "typeScaleFindings",
      "unnamedGlossaryTerms",
    ])
  })
})

/**
 * The lists above are what vitest sees of the sources. A type re-exported without `type` would be
 * one of its names, with no value, and a list that held it would promise a name the published
 * package does not export. tsc refuses that re-export (TS1205, verbatimModuleSyntax), and each name
 * carrying a runtime value holds vitest's side of it too.
 */
describe("the @miragon/pulse-ui entries", () => {
  it("give each of their names a runtime value", () => {
    const entries = { ".": ui, "./format": format, "./testing": testing, "./tones": tones }
    for (const [entry, names] of Object.entries(entries)) {
      for (const [name, value] of Object.entries(names)) {
        expect(value, `${entry} ${name}`).toBeDefined()
      }
    }
  })
})

/**
 * Consumers point Tailwind at the compiled `dist/` (`@source …/pulse-ui/dist`): the tarball
 * carries no tests or render fixtures there, whose class strings (the colour gate's palette
 * fixtures) would land in every consumer's stylesheet.
 */
describe("the published files", () => {
  it("leave the tests, their support and the render fixtures out of dist", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { files: string[] }
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        "dist",
        "!dist/**/*.test.*",
        "!dist/**/*.test-support.*",
        "!dist/render-*",
      ]),
    )
  })
})
