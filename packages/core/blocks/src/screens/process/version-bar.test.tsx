// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type { OlderVersionsData, VersionData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { OlderVersionsNotice } from "./older-versions-notice.js"
import { VersionPicker } from "./version-picker.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const SCREEN = WORLD_SCREENS.process

function pickerOf(
  props: {
    readonly versions?: readonly VersionData[]
    readonly selected?: string
    readonly label?: string
    readonly placeholder?: string
    readonly locale?: string
  } = {},
) {
  const picked: string[] = []
  const onPick = (id: string) => picked.push(id)
  const { label, placeholder, locale = "en" } = props
  const node = (selected: string | undefined) => (
    <LocaleProvider locale={locale}>
      <VersionPicker
        versions={props.versions ?? SCREEN.versions}
        selected={selected}
        {...(label === undefined ? {} : { label })}
        {...(placeholder === undefined ? {} : { placeholder })}
        onPick={onPick}
      />
    </LocaleProvider>
  )
  const rendered = render(node(props.selected))
  return {
    ...rendered,
    picked,
    select: rendered.container.querySelector("select")!,
    rerenderWith: (selected: string | undefined) => {
      rendered.rerender(node(selected))
    },
  }
}

function texts(select: HTMLSelectElement): string[] {
  return [...select.options].map((option) => option.text)
}

describe("the version picker of a process", () => {
  it("lists each version with its running instances, and with incident where there are", () => {
    const { container, select } = pickerOf({ selected: "pulse-order:2" })

    expect(container.querySelector("label")?.textContent?.startsWith("Version")).toBe(true)
    expect(texts(select)).toEqual(["v2 · 1 running", "v1 · 2 running · 1 with incident"])
    expect(select.value).toBe("pulse-order:2")
  })

  it("shows a pick at once and asks for it, until the surface shows the version", () => {
    const { select, picked, rerenderWith } = pickerOf({ selected: "pulse-order:2" })

    fireEvent.change(select, { target: { value: "pulse-order:1" } })
    expect(picked).toEqual(["pulse-order:1"])
    expect(select.value).toBe("pulse-order:1")
    rerenderWith("pulse-order:2")
    expect(select.value).toBe("pulse-order:1")
    rerenderWith("pulse-order:1")
    rerenderWith("pulse-order:2")
    expect(select.value).toBe("pulse-order:2")
  })

  it("says what to pick before a version is picked, under the surface's own name", () => {
    const { container, select, picked } = pickerOf({
      label: "Target version",
      placeholder: "Pick a version",
    })

    expect(container.querySelector("label")?.textContent?.startsWith("Target version")).toBe(true)
    expect(texts(select)[0]).toBe("Pick a version")
    fireEvent.change(select, { target: { value: "" } })
    expect(picked).toEqual([])
  })

  it("speaks German under a German locale", () => {
    const { select } = pickerOf({ locale: "de", selected: "pulse-order:1" })

    expect(texts(select)).toEqual(["v2 · 1 laufend", "v1 · 2 laufend · 1 mit Incident"])
  })
})

function noticeOf(notice: OlderVersionsData, locale = "en") {
  const shown: number[] = []
  const { container } = render(
    <LocaleProvider locale={locale}>
      <OlderVersionsNotice notice={notice} onShow={(show) => shown.push(show.version)} />
    </LocaleProvider>,
  )
  return { container, shown }
}

describe("the notice that older versions still run", () => {
  const [notice] = SCREEN.notices

  it("says how many still run, how many with incident, and offers the newest of them", () => {
    const { container, shown } = noticeOf(notice!)

    expect(container.textContent).toContain(
      "2 instances still run on older versions, 1 of them with incident.",
    )
    fireEvent.click(within(container).getByRole("button", { name: "Show v1" }))
    expect(shown).toEqual([1])
  })

  it("says one instance in the singular, without an incident where none has one", () => {
    const { container } = noticeOf({ ...notice!, running: 1, withIncident: 0 })

    expect(container.textContent).toContain("1 instance still runs on older versions.")
  })

  it("speaks German under a German locale", () => {
    const { container } = noticeOf(notice!, "de")
    expect(container.textContent).toContain(
      "2 Instanzen laufen noch auf älteren Versionen, 1 davon mit Incident.",
    )
    expect(within(container).getByRole("button", { name: "v1 zeigen" })).toBeTruthy()
    cleanup()
    expect(
      noticeOf({ ...notice!, running: 1, withIncident: 0 }, "de").container.textContent,
    ).toContain("1 Instanz läuft noch auf älteren Versionen.")
  })
})
