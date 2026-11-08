import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as format from "./format/index.js"
import * as ui from "./index.js"
import * as tones from "./tones/index.js"

/** A piece missing from the root entry is a piece no view can import. */
describe("the @miragon/pulse-ui entry", () => {
  it.each([
    // The kit pieces that came from widget-shell.
    "Icon",
    "ICON_STROKE",
    "Th",
    "Td",
    "TableEmptyState",
    "VersionChip",
    "Section",
    "NativeSelect",
    "SegmentedControl",
    "RowCard",
    "NamedId",
    "LogText",
    "LOG_TEXT_PREVIEW",
    "TEXT_BLOCK_FRAME",
    "KometMark",
    "AppEmptyState",
    "NavigationFocus",
    "MENU_ITEM",
    "createUseT",
    "useResetOnChange",
    "formatDate",
    "formatDuration",
    "formatNumber",
    "formatPercent",
    "formatPercentPoints",
    "formatPeriod",
    "formatTime",
    "formatTimestamp",
    "truncate",
    // The formatters both Pulse UIs share, and the short id that came from widget-shell.
    "formatClock",
    "formatInstant",
    "formatRelativeTime",
    "formatCount",
    "formatCompactCount",
    "shortId",
    "setFormatLocale",
    "getFormatLocale",
    "subscribeFormatLocale",
    // The tone ladder that came from widget-shell, and the situation table.
    "countTone",
    "severityTone",
    "SITUATION_TONES",
    // A sample of the design kit that came from the toolkit.
    "Button",
    "KpiGrid",
    "WidgetHeader",
    "LocaleProvider",
    "ToastProvider",
    "TONE_DOT",
    "cn",
    "ROLE_TOKENS",
  ])("exports %s", (name) => {
    expect(ui).toHaveProperty(name)
    expect(ui[name as keyof typeof ui]).toBeDefined()
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
