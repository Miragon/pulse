// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type { HeadlineData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { HeadlineStrip, type HeadlineStripProps } from "./headline-strip.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const NAMES: Readonly<Record<string, string>> = {
  Activity_PrintShippingLabel: "Print shipping label",
}
const nameOf = (elementId: string) => NAMES[elementId] ?? elementId
const SINCE = "2026-10-21T08:00:02.000Z"
const CAUSE = { rootCauseLine: "MissingBean: Cannot resolve identifier", message: "boom" }

function stripOf(
  headline: HeadlineData,
  incidents: HeadlineStripProps["incidents"] = [],
  locale = "en",
) {
  const { container } = render(
    <LocaleProvider locale={locale}>
      <HeadlineStrip headline={headline} incidents={incidents} nameOf={nameOf} />
    </LocaleProvider>,
  )
  const strip = container.querySelector<HTMLElement>('[data-slot="status-strip"]')
  return { text: strip?.textContent, tone: strip?.dataset.tone }
}

const DAY = String.raw`(\w{3} \d{1,2}, )?`

describe("the head strip of an instance", () => {
  it("says where a called instance's incident holds it, and since when", () => {
    const strip = stripOf(WORLD_SCREENS.instance.headline!)

    expect(strip.tone).toBe("danger")
    expect(strip.text).toMatch(
      new RegExp(
        `^Waits at Print shipping label on an incident in a called instance since ${DAY}08:00$`,
      ),
    )
  })

  it("says where its own incident holds it, and that it is suspended too", () => {
    const strip = stripOf({
      ...WORLD_SCREENS.calledInstance.headline!,
      suspended: true,
    } as HeadlineData)

    expect(strip.text).toMatch(
      new RegExp(`^Waits at Activity_RenderLabel on an incident since ${DAY}08:00 · suspended$`),
    )
  })

  it("says a called instance's incident holds it without an element where none leads to it", () => {
    const strip = stripOf({
      code: "incidentInCalledInstance",
      incidentId: "i-1",
      elementId: null,
      liesIn: { instanceId: "c-1" },
      since: SINCE,
      suspended: true,
    })

    expect(strip.text).toMatch(
      new RegExp(`^Waits on an incident in a called instance since ${DAY}08:00 · suspended$`),
    )
  })

  it("counts several incidents and names the first one's root cause, else its message", () => {
    expect(stripOf({ code: "incidents", count: 2, suspended: true }, [CAUSE]).text).toBe(
      "2 incidents · suspendedMissingBean: Cannot resolve identifier",
    )
    cleanup()
    expect(
      stripOf({ code: "incidents", count: 1_204, suspended: false }, [
        { rootCauseLine: null, message: "boom" },
      ]).text,
    ).toBe("1,204 incidentsboom")
    cleanup()
    expect(stripOf({ code: "incidents", count: 1, suspended: false }).text).toBe("1 incident")
  })

  it("counts the incidents of cut lists as a lower bound, in either language", () => {
    const atLeast = (count: number, suspended = false) =>
      ({ code: "incidentsAtLeast", count, suspended }) as const

    const one = stripOf(atLeast(1), [CAUSE])
    expect([one.text, one.tone]).toEqual([
      "≥ 1 incidentMissingBean: Cannot resolve identifier",
      "danger",
    ])
    cleanup()
    expect(stripOf(atLeast(1_204, true)).text).toBe("≥ 1,204 incidents · suspended")
    cleanup()
    expect(stripOf(atLeast(1), [], "de").text).toBe("≥ 1 Incident")
    cleanup()
    expect(stripOf(atLeast(2, true), [], "de").text).toBe("≥ 2 Incidents · ausgesetzt")
  })

  it("says that the instance is suspended or how it ended, as a note", () => {
    const suspended = stripOf({ code: "suspended" })
    expect([suspended.text, suspended.tone]).toEqual(["This instance is suspended.", "info"])
    cleanup()
    expect(stripOf({ code: "ended", state: "completed" }).text).toBe("This instance is completed.")
    cleanup()
    expect(stripOf({ code: "ended", state: "terminated" }).text).toBe("This instance is cancelled.")
  })

  it("speaks German under a German locale", () => {
    expect(stripOf(WORLD_SCREENS.instance.headline!, [], "de").text).toMatch(
      /^Wartet an Print shipping label auf einen Incident in einer aufgerufenen Instanz, seit .*08:00$/,
    )
    cleanup()
    expect(stripOf({ code: "incidents", count: 2, suspended: true }, [], "de").text).toBe(
      "2 Incidents · ausgesetzt",
    )
    cleanup()
    expect(stripOf({ code: "ended", state: "terminated" }, [], "de").text).toBe(
      "Diese Instanz ist abgebrochen.",
    )
  })
})
