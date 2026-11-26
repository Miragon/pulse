// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import type { InstanceListFilterData, VariableConditionKindCode } from "@miragon/pulse-screens"
import { afterEach, describe, expect, it } from "vitest"
import { VariableChips } from "./variable-chips.js"

afterEach(cleanup)

const ROUTE = { name: "route", operator: "equals", value: "review" } as const
const AMOUNT = { name: "amount", operator: "greaterThan", value: "100" } as const

interface Shown {
  readonly filter?: InstanceListFilterData
  readonly labels?: readonly string[]
  readonly refused?: readonly VariableConditionKindCode[]
  readonly locale?: string
  readonly suggest?: boolean
}

function chipsOf({
  filter = { scope: "running" },
  labels,
  refused,
  locale = "en",
  suggest,
}: Shown = {}) {
  const asked: InstanceListFilterData[] = []
  const suggested: string[] = []
  const { container } = render(
    <LocaleProvider locale={locale}>
      <VariableChips
        filter={filter}
        labels={labels}
        names={["amount", "route"]}
        refused={refused}
        {...(suggest === true ? { onSuggest: () => suggested.push("names") } : {})}
        onFilter={(next) => asked.push(next)}
      />
    </LocaleProvider>,
  )
  return { container, asked, suggested }
}

function dialogIn(container: HTMLElement): HTMLDialogElement {
  const dialog = container.querySelector("dialog")
  if (dialog === null) throw new Error("No dialog is open.")
  return dialog
}

function fieldOf(dialog: HTMLElement, label: string): HTMLInputElement & HTMLSelectElement {
  const target = [...dialog.querySelectorAll("label")].find((one) => one.textContent === label)
  return dialog.querySelector(`#${CSS.escape(target?.htmlFor ?? "")}`)!
}

function options(select: HTMLSelectElement): [string, boolean, string][] {
  return [...select.options].map((option) => [option.text, option.disabled, option.title])
}

function change(control: HTMLInputElement | HTMLSelectElement, value: string): void {
  fireEvent.change(control, { target: { value } })
}

describe("the variable conditions of an instance list", () => {
  it("offer a dialog to add one, which the surface may read names for, and add it", () => {
    const { container, asked, suggested } = chipsOf({ suggest: true })
    const opener = within(container).getByRole("button", { name: "Filter by variables" })

    fireEvent.click(opener)
    const dialog = dialogIn(container)
    expect(suggested).toEqual(["names"])
    expect(dialog.querySelector("h2")?.textContent).toBe("Filter by variable")
    expect(
      [...dialog.querySelectorAll("datalist option")].map((option) => option.getAttribute("value")),
    ).toEqual(["amount", "route"])
    change(fieldOf(dialog, "Name"), " amount ")
    change(fieldOf(dialog, "Operator"), "greaterThan")
    change(fieldOf(dialog, "Value"), "100")
    fireEvent.submit(dialog.querySelector("form")!)

    expect(asked).toEqual([{ scope: "running", variables: [AMOUNT] }])
    expect(container.querySelector("dialog")).toBeNull()
  })

  it("show a chip per condition, by the surface's words or the block's, that edits or removes it", () => {
    const filter: InstanceListFilterData = { scope: "running", variables: [ROUTE, AMOUNT] }
    const { container, asked } = chipsOf({ filter, labels: ['route = "review"'] })

    expect(
      within(container).getByRole("button", { name: "Filter by variables, 2 conditions" })
        .textContent,
    ).toBe("2")
    expect(
      within(container).getByRole("button", { name: "Remove condition amount > 100" }),
    ).toBeTruthy()
    fireEvent.click(
      within(container).getByRole("button", { name: 'Remove condition route = "review"' }),
    )
    expect(asked).toEqual([{ scope: "running", variables: [AMOUNT] }])

    fireEvent.click(within(container).getByRole("button", { name: "Edit condition amount > 100" }))
    const dialog = dialogIn(container)
    expect(dialog.querySelector("h2")?.textContent).toBe("Edit variable condition")
    expect(fieldOf(dialog, "Value").value).toBe("100")
    change(fieldOf(dialog, "Value"), "200")
    fireEvent.submit(dialog.querySelector("form")!)
    expect(asked[1]).toEqual({
      scope: "running",
      variables: [ROUTE, { ...AMOUNT, value: "200" }],
    })
  })

  it("closes on Cancel and on Escape, applying nothing, and returns the focus to its opener", () => {
    const { container, asked } = chipsOf()
    const opener = within(container).getByRole("button", { name: "Filter by variables" })

    fireEvent.click(opener)
    fireEvent.click(within(dialogIn(container)).getByRole("button", { name: "Cancel" }))
    expect(container.querySelector("dialog")).toBeNull()
    expect(document.activeElement).toBe(opener)

    fireEvent.click(opener)
    fireEvent(dialogIn(container), new Event("cancel", { cancelable: true }))
    expect(container.querySelector("dialog")).toBeNull()
    expect(asked).toEqual([])
  })

  it("says inline what is wrong instead of applying, and the focus goes there", () => {
    const filter: InstanceListFilterData = {
      scope: "running",
      variables: [ROUTE, ROUTE, ROUTE, ROUTE, ROUTE],
    }
    const { container, asked } = chipsOf({ filter })
    fireEvent.click(
      within(container).getByRole("button", { name: "Filter by variables, 5 conditions" }),
    )
    const dialog = dialogIn(container)

    change(fieldOf(dialog, "Operator"), "lessThan")
    change(fieldOf(dialog, "Value"), "a lot")
    fireEvent.submit(dialog.querySelector("form")!)

    expect(dialog.textContent).toContain("Enter a variable name.")
    expect(dialog.textContent).toContain("Enter a number, for example 42 or 9.5.")
    expect(within(dialog).getByRole("alert").textContent).toBe("Use 5 conditions or fewer.")
    expect(document.activeElement).toBe(fieldOf(dialog, "Name"))
    change(fieldOf(dialog, "Compare as"), "date")
    fireEvent.submit(dialog.querySelector("form")!)
    expect(dialog.textContent).toContain("Pick a date and time.")
    expect(asked).toEqual([])
  })

  it("words each type, its operators, its value and its hints", () => {
    const { container } = chipsOf()
    fireEvent.click(within(container).getByRole("button", { name: "Filter by variables" }))
    const dialog = dialogIn(container)
    const operators = () => options(fieldOf(dialog, "Operator")).map(([text]) => text)

    expect(options(fieldOf(dialog, "Compare as")).map(([text]) => text)).toEqual([
      "Automatic",
      "Text",
      "Number",
      "True or false",
      "Date and time",
      "Null",
    ])
    expect(operators()).toEqual(["is", "is not", "matches", "is greater than", "is less than"])
    change(fieldOf(dialog, "Operator"), "like")
    expect(dialog.textContent).toContain(
      "Automatic compares 42 as a number, true as true or false and anything else as text. Use * as a wildcard, for example ORD-*",
    )
    change(fieldOf(dialog, "Compare as"), "date")
    expect(operators()).toEqual(["is", "is not", "is after", "is before"])
    expect(fieldOf(dialog, "Value").type).toBe("datetime-local")
    change(fieldOf(dialog, "Compare as"), "null")
    expect(operators()).toEqual(["is null", "is not null"])
    expect([...dialog.querySelectorAll("label")].map((label) => label.textContent)).toEqual([
      "Name",
      "Compare as",
      "Operator",
    ])
    change(fieldOf(dialog, "Compare as"), "boolean")
    expect(options(fieldOf(dialog, "Value")).map(([text]) => text)).toEqual(["true", "false"])
    change(fieldOf(dialog, "Value"), "false")
    expect(fieldOf(dialog, "Value").value).toBe("false")
    change(fieldOf(dialog, "Compare as"), "text")
    expect(dialog.textContent).not.toContain("Automatic compares")
  })

  it("offers the kinds the engine refuses disabled, with their reason, and refuses them on Apply", () => {
    const filter: InstanceListFilterData = { scope: "running", variables: [AMOUNT] }
    const { container, asked } = chipsOf({ filter, refused: ["ordering", "date"] })
    fireEvent.click(within(container).getByRole("button", { name: "Edit condition amount > 100" }))
    const dialog = dialogIn(container)

    expect(options(fieldOf(dialog, "Compare as"))[4]).toEqual([
      "Date and time",
      true,
      "This engine can't compare dates.",
    ])
    expect(options(fieldOf(dialog, "Operator")).slice(2)).toEqual([
      ["matches", false, ""],
      ["is greater than", true, "This engine can't search for greater or less than."],
      ["is less than", true, "This engine can't search for greater or less than."],
    ])
    expect(dialog.textContent).toContain(
      "JSON and object variables can't be searched. This engine can't compare dates.",
    )
    fireEvent.submit(dialog.querySelector("form")!)
    expect(fieldOf(dialog, "Operator").getAttribute("aria-invalid")).toBe("true")
    change(fieldOf(dialog, "Compare as"), "number")
    expect(fieldOf(dialog, "Operator").value).toBe("equals")
    expect(asked).toEqual([])
  })

  it("names the refused date at Compare as where an edited condition holds one", () => {
    const due = {
      name: "dueAt",
      operator: "equals",
      value: "2026-03-15T10:00",
      as: "date",
    } as const
    const { container } = chipsOf({ filter: { scope: "all", variables: [due] }, refused: ["date"] })
    fireEvent.click(
      within(container).getByRole("button", { name: "Edit condition dueAt = 2026-03-15 10:00" }),
    )
    const dialog = dialogIn(container)

    fireEvent.submit(dialog.querySelector("form")!)

    expect(fieldOf(dialog, "Compare as").getAttribute("aria-invalid")).toBe("true")
    expect(options(fieldOf(dialog, "Operator")).every(([, disabled]) => !disabled)).toBe(true)
  })

  it("returns the focus to its opener where the chip that opened it went, and suggests no name it lacks", () => {
    const filter: InstanceListFilterData = { scope: "all", variables: [ROUTE] }
    const node = (shown: InstanceListFilterData) => (
      <VariableChips filter={shown} onFilter={() => undefined} />
    )
    const { container, rerender } = render(node(filter))
    fireEvent.click(
      within(container).getByRole("button", { name: 'Edit condition route = "review"' }),
    )
    const dialog = dialogIn(container)
    expect(dialog.querySelectorAll("datalist option")).toHaveLength(0)
    fireEvent.keyDown(dialog, { key: "a" })

    rerender(node({ scope: "all" }))
    fireEvent.click(within(dialogIn(container)).getByRole("button", { name: "Cancel" }))

    expect(document.activeElement).toBe(
      within(container).getByRole("button", { name: "Filter by variables" }),
    )
  })

  it("speaks German under a German locale", async () => {
    const { container } = chipsOf({
      filter: { scope: "running", variables: [ROUTE] },
      refused: ["ordering"],
      locale: "de",
    })
    expect(
      within(container).getByRole("button", { name: "Nach Variablen filtern, 1 Bedingung" }),
    ).toBeTruthy()
    expect(
      within(container).getByRole("button", { name: 'Bedingung route = "review" bearbeiten' }),
    ).toBeTruthy()

    await act(async () => {
      fireEvent.click(
        within(container).getByRole("button", { name: 'Bedingung route = "review" entfernen' }),
      )
      fireEvent.click(within(container).getByRole("button", { name: /^Nach Variablen filtern/ }))
      await Promise.resolve()
    })
    const dialog = dialogIn(container)
    expect(dialog.querySelector("h2")?.textContent).toBe("Nach Variable filtern")
    expect(options(fieldOf(dialog, "Operator")).map(([text]) => text)).toEqual([
      "ist",
      "ist nicht",
      "passt zu",
      "ist größer als",
      "ist kleiner als",
    ])
    expect(dialog.textContent).toContain("Diese Engine sucht nicht nach größer oder kleiner als.")
    expect(within(dialog).getByRole("button", { name: "Anwenden" })).toBeTruthy()
  })
})
