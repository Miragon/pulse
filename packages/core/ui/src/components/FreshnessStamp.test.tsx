// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { formatInstant, setFormatLocale } from "../format/index.js"
import { LocaleProvider } from "../locale/locale-provider.js"
import { FreshnessStamp } from "./FreshnessStamp.js"

/** FreshnessStamp: when a view's or a page's numbers were read, for its bar's freshness slot. */

afterEach(() => {
  cleanup()
  setFormatLocale(undefined)
})

const AS_OF = "2026-10-10T12:32:00.000Z"
const stamp = () => document.querySelector("[data-slot='freshness-stamp']")

describe("FreshnessStamp", () => {
  it("says the time without seconds, the whole instant in its title, behind a clock", () => {
    setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "Europe/Berlin" })
    render(<FreshnessStamp at={AS_OF} />)
    expect(stamp()?.textContent).toMatch(/^As of (Oct 10, )?14:32$/)
    expect(stamp()?.getAttribute("title")).toBe(formatInstant(AS_OF))
    expect(stamp()?.querySelector("svg")?.getAttribute("class")).toContain("lucide-clock")
    cleanup()
    render(<FreshnessStamp at={new Date().toISOString()} />)
    expect(screen.getByText(/^As of \d\d:\d\d$/)).toBeTruthy()
  })

  it("takes a Date as well as an ISO timestamp", () => {
    setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "Europe/Berlin" })
    render(<FreshnessStamp at={new Date(AS_OF)} />)
    expect(stamp()?.getAttribute("title")).toBe(formatInstant(AS_OF))
  })

  it("speaks the language of the nearest LocaleProvider", () => {
    setFormatLocale({ language: "de", locale: "de-DE", timeZone: "Europe/Berlin" })
    render(
      <LocaleProvider locale="de">
        <FreshnessStamp at={new Date().toISOString()} />
      </LocaleProvider>,
    )
    expect(screen.getByText(/^Stand \d\d:\d\d$/)).toBeTruthy()
  })

  it("shows nothing for no time or one that does not parse", () => {
    for (const at of [null, undefined, "", "not a time", new Date(Number.NaN)]) {
      const { container } = render(<FreshnessStamp at={at} />)
      expect(container.innerHTML).toBe("")
      cleanup()
    }
  })
})
