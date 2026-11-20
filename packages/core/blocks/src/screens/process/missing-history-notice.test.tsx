// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type { ScopeCountsData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MissingHistoryNotice } from "./missing-history-notice.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

/** A history level NONE: the history holds no instance, the runtime runs two of version 1. */
const NONE: ScopeCountsData = { running: 0, withIncident: 1, ended: 0, all: 0 }

const [, v1] = WORLD_SCREENS.olderVersion.versions

function noticeOf(counts: ScopeCountsData | null, locale = "en", running = v1?.running ?? 0) {
  return render(
    <LocaleProvider locale={locale}>
      <MissingHistoryNotice version={{ running }} filter={{ scope: "running" }} counts={counts} />
    </LocaleProvider>,
  )
}

describe("the notice of a history that misses running instances", () => {
  it("says how many of the running instances the history holds and what the list shows", () => {
    const { container } = noticeOf(NONE)

    expect(v1?.running).toBe(2)
    expect(container.textContent).toContain("The history misses running instances")
    expect(container.textContent).toContain(
      "The engine's history holds 0 of 2 running instances on this version. The list shows only the instances in the history.",
    )
    expect(container.querySelector("[data-tone=warning]")).not.toBeNull()
  })

  it("names one running instance in the singular, in English and German", () => {
    expect(noticeOf(NONE, "en", 1).container.textContent).toContain("0 of 1 running instance on")
    cleanup()
    const { container } = noticeOf(NONE, "de", 1)
    expect(container.textContent).toContain("Der Historie fehlen laufende Instanzen")
    expect(container.textContent).toContain(
      "Die Historie der Engine kennt 0 von 1 laufenden Instanz auf dieser Version. Die Liste zeigt nur die Instanzen aus der Historie.",
    )
  })

  it("renders nothing over a history that holds what runs, or before the counts were read", () => {
    expect(noticeOf(WORLD_SCREENS.instanceList.counts).container.textContent).toBe("")
    expect(noticeOf(null).container.textContent).toBe("")
  })
})
