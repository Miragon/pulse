import { afterEach, beforeEach, vi } from "vitest"
import type { ComponentType } from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import { LocaleProvider, queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import { setFormatLocale } from "@miragon/pulse-widget-shell/testing"

export const NOW = "2026-10-10T12:40:00.000Z"
export const AS_OF = "2026-10-10T12:32:00.000Z"

/** Fixes the clock at {@link NOW} and resets the view state after each test. */
export function withWidgetClock() {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date(NOW))
  })
  afterEach(() => {
    cleanup()
    queryClient.clear()
    setFormatLocale(undefined)
    vi.useRealTimers()
  })
}

export function renderIn(
  language: "de" | "en",
  Widget: ComponentType<{ data: never }>,
  data: unknown,
  /** The tools a self-fetching widget calls (e.g. the heatmap's diagram feed). */
  tools?: Record<string, unknown>,
) {
  setFormatLocale({
    language,
    locale: language === "de" ? "de-DE" : "en-GB",
    timeZone: "Europe/Berlin",
  })
  return render(
    <LocaleProvider locale={language}>
      <WidgetFixtureHost
        widget={Widget as unknown as ComponentType<Record<string, unknown>>}
        data={data as Record<string, unknown>}
        tools={tools}
      />
    </LocaleProvider>,
  )
}

const NBSP = String.fromCharCode(0xa0)

/** Text with the formatters' no-break spaces as plain spaces. */
export const plain = (s: string | null | undefined) => s?.replaceAll(NBSP, " ")
export const metaLine = () => plain(document.querySelector("[data-view-meta]")?.textContent)
export const iconOf = (el: HTMLElement) => el.querySelector("svg")?.getAttribute("class") ?? ""

/** The tone of the KPI cell labelled `label` (its dot), or undefined for a neutral one. */
export const kpiTone = (label: string) =>
  screen.getByText(label).closest("[data-tone]")?.getAttribute("data-tone") ?? undefined

/**
 * Includes the heads a narrow region hides: happy-dom has no layout, so every `hideBelow` query
 * reads as too narrow. Group heads are not column heads.
 */
export const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole("columnheader", { hidden: true })
    .filter((th) => th.getAttribute("scope") === "col" && !inGroupRow(th))
    .map((th) => plain(th.textContent)?.trim())

const inGroupRow = (th: HTMLElement) => th.closest("tr")?.hasAttribute("data-list-table-groups")

/** The heads of the column groups: their text and how many columns each spans. */
export const groupHeads = (table: HTMLElement) =>
  within(table)
    .getAllByRole("columnheader", { hidden: true })
    .filter(inGroupRow)
    .map((th) => [plain(th.textContent)?.trim(), th.getAttribute("colspan")])

/**
 * Each "—" as each reader gets it: the sign (hidden from assistive tech), the reason read out, and
 * the tooltip.
 */
export const missingFigures = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>("[data-figure='missing']")].map((el) => ({
    shown: el.querySelector("[aria-hidden='true']")?.textContent,
    read: el.querySelector(".sr-only")?.textContent,
    title: el.getAttribute("title"),
  }))

export const missing = (why: string) => ({ shown: "—", read: why, title: why })

/** The notes under the tables (`Legend`), as text. */
export const legendLines = () =>
  [...document.querySelectorAll("[data-legend]")].map((p) => plain(p.textContent)?.trim())
