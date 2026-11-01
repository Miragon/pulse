import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import * as ui from "./index.js"

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
    "setFormatLocale",
    "getFormatLocale",
    "subscribeFormatLocale",
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
      "formatCount",
    ]) {
      expect(ui, name).not.toHaveProperty(name)
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
