// @vitest-environment happy-dom
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { setFormatLocale, type Count } from "../format/index.js"
import { LocaleProvider } from "../locale/locale-provider.js"
import { SegmentedControl, type SegmentedControlOption } from "./segmented-control.js"

/**
 * SegmentedControl, the webview's scope segments in the kit (D9): a radio group with one tab
 * stop whose arrows, Home and End move the check and the focus together; counts compact on screen
 * and exact for a screen reader; a note per option; and while a change runs, aria-busy and the
 * picked segment checked before `value` follows. The look is pinned in `tone-components.test.tsx`.
 */

afterEach(() => {
  cleanup()
  setFormatLocale(undefined)
})

type Scope = "all" | "incident" | "suspended"

const LABELS: Record<Scope, string> = {
  all: "All",
  incident: "With incident",
  suspended: "Suspended",
}

const SCOPES: SegmentedControlOption<Scope>[] = (["all", "incident", "suspended"] as const).map(
  (value) => ({ value, label: LABELS[value] }),
)

function renderScopes(value: Scope = "all", onChange = vi.fn()) {
  render(<SegmentedControl ariaLabel="Scope" options={SCOPES} value={value} onChange={onChange} />)
  return onChange
}

const radio = (name: string | RegExp) => screen.getByRole("radio", { name })
const checked = () =>
  screen
    .getAllByRole("radio")
    .filter((option) => option.getAttribute("aria-checked") === "true")
    .map((option) => option.textContent)

describe("SegmentedControl: a radio group", () => {
  it("is a named radio group of radios, the checked one aria-checked and the group's one tab stop", () => {
    renderScopes("incident")
    const group = screen.getByRole("radiogroup", { name: "Scope" })
    expect(group.getAttribute("data-slot")).toBe("segmented-control")
    const options = screen.getAllByRole("radio")
    expect(options.map((option) => option.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ])
    expect(options.map((option) => option.tabIndex)).toEqual([-1, 0, -1])
    expect(options.map((option) => option.getAttribute("data-state"))).toEqual([
      "unchecked",
      "checked",
      "unchecked",
    ])
    // No toggle-button state any more: the radios say it.
    for (const option of options) expect(option.hasAttribute("aria-pressed")).toBe(false)
  })

  it("keeps the first option a tab stop while its value is none of the options", () => {
    render(
      <SegmentedControl
        ariaLabel="Scope"
        options={SCOPES}
        value={"other" as Scope}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getAllByRole("radio").map((option) => option.tabIndex)).toEqual([0, -1, -1])
  })

  it("reports the option you click, and nothing for the one already checked", () => {
    const onChange = renderScopes("all")
    fireEvent.click(radio("Suspended"))
    expect(onChange).toHaveBeenCalledWith("suspended")
    onChange.mockClear()
    cleanup()
    renderScopes("all", onChange)
    fireEvent.click(radio("All"))
    expect(onChange).not.toHaveBeenCalled()
  })

  it("disabled, keeps its check and takes no change: every segment disabled, the group too", () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        ariaLabel="Scope"
        options={SCOPES}
        value="incident"
        onChange={onChange}
        disabled
      />,
    )
    expect(screen.getByRole("radiogroup").getAttribute("aria-disabled")).toBe("true")
    for (const name of ["All", "With incident", "Suspended"]) {
      expect((radio(name) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(radio("With incident").getAttribute("aria-checked")).toBe("true")
    fireEvent.click(radio("Suspended"))
    expect(onChange).not.toHaveBeenCalled()
    // Opaque, never faded.
    expect(radio("Suspended").className).not.toMatch(/opacity/)
  })
})

describe("SegmentedControl: the keyboard", () => {
  function Scopes({ onChange }: { onChange: (next: Scope) => void }) {
    const [value, setValue] = useState<Scope>("all")
    return (
      <SegmentedControl
        ariaLabel="Scope"
        options={SCOPES}
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }

  it.each([
    ["ArrowRight", "all", "incident"],
    ["ArrowDown", "all", "incident"],
    ["ArrowRight", "suspended", "all"],
    ["ArrowLeft", "incident", "all"],
    ["ArrowUp", "incident", "all"],
    ["ArrowLeft", "all", "suspended"],
    ["Home", "suspended", "all"],
    ["End", "all", "suspended"],
  ] as const)("%s from %s checks and focuses %s", (key, from, to) => {
    const onChange = vi.fn()
    render(<Scopes onChange={onChange} />)
    if (from !== "all") fireEvent.click(radio(LABELS[from]))
    onChange.mockClear()
    const focused = radio(LABELS[from])
    focused.focus()
    fireEvent.keyDown(focused, { key })
    const target = LABELS[to]
    expect(onChange).toHaveBeenCalledWith(to)
    expect(document.activeElement).toBe(radio(target))
    expect(checked()).toEqual([target])
    expect(radio(target).tabIndex).toBe(0)
  })

  it("leaves other keys and a modified arrow to the browser", () => {
    const onChange = vi.fn()
    render(<Scopes onChange={onChange} />)
    const all = radio("All")
    all.focus()
    for (const init of [
      { key: "Tab" },
      { key: "a" },
      { key: "ArrowRight", altKey: true },
      { key: "ArrowRight", ctrlKey: true },
      { key: "ArrowRight", metaKey: true },
    ]) {
      expect(fireEvent.keyDown(all, init), JSON.stringify(init)).toBe(true)
    }
    expect(onChange).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(all)
  })
})

describe("SegmentedControl: a change that runs", () => {
  function Host({ value, busy }: { value: Scope; busy: boolean }) {
    return (
      <SegmentedControl
        ariaLabel="Scope"
        options={SCOPES}
        value={value}
        busy={busy}
        onChange={() => undefined}
      />
    )
  }

  it("marks the group busy while it runs", () => {
    const { rerender } = render(<Host value="all" busy={false} />)
    expect(screen.getByRole("radiogroup").getAttribute("aria-busy")).toBe("false")
    rerender(<Host value="all" busy />)
    expect(screen.getByRole("radiogroup").getAttribute("aria-busy")).toBe("true")
  })

  it("checks the picked option at once, before the value follows, then follows the value", () => {
    const { rerender } = render(<Host value="all" busy={false} />)
    fireEvent.click(radio("Suspended"))
    expect(checked()).toEqual(["Suspended"])
    expect(radio("Suspended").tabIndex).toBe(0)
    // The host starts the change: the check stays where you put it.
    rerender(<Host value="all" busy />)
    expect(checked()).toEqual(["Suspended"])
    // The value follows: the check is the value's.
    rerender(<Host value="suspended" busy={false} />)
    expect(checked()).toEqual(["Suspended"])
    rerender(<Host value="incident" busy={false} />)
    expect(checked()).toEqual(["With incident"])
  })

  it("goes back to the value when the change ends without it", () => {
    const { rerender } = render(<Host value="all" busy />)
    fireEvent.click(radio("With incident"))
    expect(checked()).toEqual(["With incident"])
    rerender(<Host value="all" busy={false} />)
    expect(checked()).toEqual(["All"])
  })

  it("drops the pick when you pick the value again", () => {
    const onChange = vi.fn()
    render(
      <SegmentedControl
        ariaLabel="Scope"
        options={SCOPES}
        value="all"
        busy={false}
        onChange={onChange}
      />,
    )
    fireEvent.click(radio("Suspended"))
    fireEvent.click(radio("All"))
    expect(onChange.mock.calls).toEqual([["suspended"], ["all"]])
    expect(checked()).toEqual(["All"])
  })

  it("holds no pick without busy: a change its parent declines goes back to the value at once", () => {
    const onChange = renderScopes("all")
    fireEvent.click(radio("Suspended"))
    expect(onChange).toHaveBeenCalledWith("suspended")
    expect(checked()).toEqual(["All"])
    expect(radio("All").tabIndex).toBe(0)
    expect(screen.getByRole("radiogroup").getAttribute("aria-busy")).toBe("false")
    // The keyboard too: the focus moves, the check stays the value's, and the next try reports again.
    const all = radio("All")
    all.focus()
    fireEvent.keyDown(all, { key: "ArrowRight" })
    expect(onChange).toHaveBeenLastCalledWith("incident")
    expect(document.activeElement).toBe(radio("With incident"))
    expect(checked()).toEqual(["All"])
    fireEvent.click(radio("Suspended"))
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(checked()).toEqual(["All"])
  })
})

describe("SegmentedControl: counts and notes", () => {
  function counted(count: Count, note?: string) {
    render(
      <SegmentedControl
        ariaLabel="Scope"
        options={[{ value: "all", label: "All", count, note }]}
        value="all"
        onChange={vi.fn()}
      />,
    )
    return radio(/^All/)
  }

  it.each([
    [12_345, "12.3k", "12,345"],
    [{ atLeast: 2000 }, "2k+", "at least 2,000"],
    [null, "—", "count unknown"],
  ] as const)("%j shows %s and reads %s", (count, shown, read) => {
    const option = counted(count)
    expect(option.querySelector("[aria-hidden='true']")?.textContent).toBe(shown)
    expect(option.querySelector(".sr-only")?.textContent).toBe(read)
    // The radio's name: its label and the count's words, never the compact figure.
    expect(screen.getByRole("radio", { name: new RegExp(`^All\\s*${read}$`) })).toBe(option)
  })

  it("reads a capped and an unknown count in the locale's words", () => {
    render(
      <LocaleProvider locale="de">
        <SegmentedControl
          ariaLabel="Umfang"
          options={[
            { value: "all", label: "Alle", count: { atLeast: 2000 } },
            { value: "suspended", label: "Ausgesetzt", count: undefined },
            { value: "incident", label: "Mit Incident", count: null },
          ]}
          value="all"
          onChange={vi.fn()}
        />
      </LocaleProvider>,
    )
    expect(radio(/^Alle/).querySelector(".sr-only")?.textContent).toBe("mindestens 2.000")
    // No count, no slot.
    expect(radio("Ausgesetzt").querySelector(".sr-only")).toBeNull()
    expect(radio(/^Mit Incident/).querySelector(".sr-only")?.textContent).toBe("Anzahl unbekannt")
  })

  it("writes its counts in the kit's locale, whatever the format locale says", () => {
    // The format locale is English here; the kit's words are German, so are its numbers.
    setFormatLocale({ language: "en", locale: "en" })
    render(
      <LocaleProvider locale="de">
        <SegmentedControl
          ariaLabel="Umfang"
          options={[
            { value: "all", label: "Alle", count: 12_345 },
            { value: "incident", label: "Mit Incident", count: { atLeast: 2000 } },
            { value: "suspended", label: "Ausgesetzt", count: 1_500_000 },
          ]}
          value="all"
          onChange={vi.fn()}
        />
      </LocaleProvider>,
    )
    const shown = (name: RegExp) => radio(name).querySelector("[aria-hidden='true']")?.textContent
    const read = (name: RegExp) => radio(name).querySelector(".sr-only")?.textContent
    // German shortens from a million on.
    expect([shown(/^Alle/), read(/^Alle/)]).toEqual(["12.345", "12.345"])
    expect([shown(/^Mit Incident/), read(/^Mit Incident/)]).toEqual(["2.000+", "mindestens 2.000"])
    expect(shown(/^Ausgesetzt/)).toBe("1,5\u00a0Mio.")
    expect(read(/^Ausgesetzt/)).toBe("1.500.000")
  })

  it("writes English for a locale Intl refuses, never throwing inside the render", () => {
    render(
      <LocaleProvider locale="not a locale">
        <SegmentedControl
          ariaLabel="Scope"
          options={[{ value: "all", label: "All", count: { atLeast: 12_345 } }]}
          value="all"
          onChange={vi.fn()}
        />
      </LocaleProvider>,
    )
    expect(radio(/^All/).querySelector("[aria-hidden='true']")?.textContent).toBe("12.3k+")
    expect(radio(/^All/).querySelector(".sr-only")?.textContent).toBe("at least 12,345")
  })

  it("gives an option's note as its title, so a screen reader reads it as the description", () => {
    const option = counted({ atLeast: 2000 }, "Counted up to 2,000")
    expect(option.getAttribute("title")).toBe("Counted up to 2,000")
  })
})
