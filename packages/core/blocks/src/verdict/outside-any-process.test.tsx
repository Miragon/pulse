// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type OutsideAnyProcessData, OutsideAnyProcessNotice } from "./outside-any-process.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

function notice(outside: OutsideAnyProcessData | undefined, engine?: string, locale = "en") {
  return render(
    <LocaleProvider locale={locale}>
      <OutsideAnyProcessNotice outside={outside} {...(engine === undefined ? {} : { engine })} />
    </LocaleProvider>,
  ).container
}

const part = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-part="outside-any-process"]')

describe("the line of an engine's open root incidents outside any process", () => {
  it("names them apart, in an open incident's tone, and says no process counts them", () => {
    const container = notice({ count: 1, atLeast: false })
    expect(part(container)?.textContent).toContain("1 incident outside any process")
    expect(part(container)?.textContent).toContain(
      "A batch or the history cleanup raised it. No process counts it, the engine's state does.",
    )
    expect(part(container)?.textContent).not.toContain("There may be more")
    expect(container.querySelector('[data-tone="danger"], .bg-danger-surface')).not.toBeNull()
  })

  it("is a lower bound where the scan stopped, and says so", () => {
    const container = notice({ count: 2000, atLeast: true })
    // The kit's lower bound, `≥` before a no-break space.
    expect(part(container)?.textContent).toContain("≥\u00a02,000 incidents outside any process")
    expect(part(container)?.textContent).toContain(
      "There may be more: Pulse reads only the newest open incidents.",
    )
  })

  it("names its engine where a surface shows several, in German too", () => {
    expect(part(notice({ count: 2, atLeast: false }, "prod", "de"))?.textContent).toContain(
      "prod: 2 Incidents außerhalb von Prozessen",
    )
  })

  it("shows nothing before the verdict answered, nor where none was read outside any process", () => {
    expect(part(notice(undefined))).toBeNull()
    expect(part(notice({ count: 0, atLeast: false }))).toBeNull()
    // A cut scan that holds none says nothing either: the verdict judged none.
    expect(part(notice({ count: 0, atLeast: true }))).toBeNull()
  })
})
