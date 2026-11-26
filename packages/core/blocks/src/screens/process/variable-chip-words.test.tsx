// @vitest-environment happy-dom
import { cleanup, render, within } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import type { InstanceListFilterData } from "@miragon/pulse-screens"
import { afterEach, describe, expect, it } from "vitest"
import { VariableChips } from "./variable-chips.js"

afterEach(cleanup)

const FILTER: InstanceListFilterData = {
  scope: "all",
  variables: [
    { name: "amount", operator: "greaterThan", value: "100" },
    { name: "amount", operator: "lessThan", value: "500" },
    { name: "route", operator: "notEquals", value: "review" },
    { name: "route", operator: "like", value: "rev%" },
    { name: "approved", operator: "equals", value: "true" },
    { name: "dueAt", operator: "greaterThan", value: "2026-03-15T10:00", as: "date" },
    { name: "giftNote", operator: "notEquals", value: "", as: "null" },
    { name: "code", operator: "equals", value: "42", as: "text" },
  ],
}

function removeNamesIn(locale: string, labels?: readonly string[]): string[] {
  const { container } = render(
    <LocaleProvider locale={locale}>
      <VariableChips filter={FILTER} labels={labels} onFilter={() => undefined} />
    </LocaleProvider>,
  )
  return within(container)
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((name) => /^(Remove condition |Bedingung .* entfernen$)/.test(name))
}

describe("a variable condition's chip without the surface's words", () => {
  it.each([
    [
      "en",
      [
        "Remove condition amount > 100",
        "Remove condition amount < 500",
        'Remove condition route ≠ "review"',
        'Remove condition route matches "rev%"',
        "Remove condition approved = true",
        "Remove condition dueAt > 2026-03-15 10:00",
        "Remove condition giftNote ≠ null",
        'Remove condition code = "42"',
      ],
    ],
    [
      "de",
      [
        "Bedingung amount > 100 entfernen",
        "Bedingung amount < 500 entfernen",
        'Bedingung route ≠ "review" entfernen',
        'Bedingung route passt zu "rev%" entfernen',
        "Bedingung approved = true entfernen",
        "Bedingung dueAt > 2026-03-15 10:00 entfernen",
        "Bedingung giftNote ≠ null entfernen",
        'Bedingung code = "42" entfernen',
      ],
    ],
  ])(
    "is worded as the editors' core words it, so two on one variable read apart (%s)",
    (locale, names) => {
      expect(removeNamesIn(locale)).toEqual(names)
    },
  )

  it("takes the surface's words where it has them, condition by condition", () => {
    expect(removeNamesIn("en", ["Amount above 100"]).slice(0, 2)).toEqual([
      "Remove condition Amount above 100",
      "Remove condition amount < 500",
    ])
  })
})
