// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import type { VariableRowData } from "@miragon/pulse-screens"
import { afterEach, describe, expect, it, vi } from "vitest"
import { SURFACES, editorInstanceSlots } from "./instance-slots.test-support.js"
import { VariablesTable, type VariableEditorSlot } from "./variables-table.js"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const CUSTOMER = '{"id":"C-77","tags":["b2b",{}],"address":{"city":"Munich"},"empty":[]}'

const VARIABLES: readonly (VariableRowData & { readonly editable?: true })[] = [
  { name: "orderId", type: "String", valueJson: '"ORD-10442"', truncated: false, editable: true },
  { name: "customer", type: "Json", valueJson: CUSTOMER, truncated: false },
  {
    name: "items",
    valueJson: '[{"sku":"A-100","qty":2},{"sku":"B-220"',
    truncated: true,
    scopeElementId: "Activity_CheckCredit",
  },
]

const nameOf = (elementId: string) =>
  elementId === "Activity_CheckCredit" ? "Check credit" : elementId

function cellsOf(container: HTMLElement): string[][] {
  return [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent),
  )
}

describe.each(SURFACES)("an instance's variables with %s", (_surface, slotsOf) => {
  it("list each name, type, value and scope, and say which value the engine cut off", () => {
    const { container } = render(
      <VariablesTable variables={VARIABLES} nameOf={nameOf} slots={slotsOf().slots} />,
    )
    const table = within(container).getByRole("table", { name: "Variables" })

    expect([...table.querySelectorAll("th")].map((head) => head.textContent)).toEqual([
      "Name",
      "Type",
      "Value",
      "Scope",
    ])
    expect(cellsOf(container)).toEqual([
      ["orderId", "String", '"ORD-10442"', "Process"],
      ["customer", "Json", CUSTOMER, "Process"],
      ["items", "—", '[{"sku":"A-100","qty":2},{"sku":"B-220"cut off', "Check credit"],
    ])
    expect(within(container).getByText(CUSTOMER).getAttribute("title")).toBe(CUSTOMER)
    expect(
      within(container).getByText('[{"sku":"A-100","qty":2},{"sku":"B-220"').getAttribute("title"),
    ).toBe('[{"sku":"A-100","qty":2},{"sku":"B-220" (cut off)')
  })

  it("opens a long value on lines of its own, as JSON laid out, and a cut one as the engine gave it", () => {
    const { container } = render(
      <VariablesTable variables={VARIABLES} nameOf={nameOf} slots={slotsOf().slots} />,
    )

    expect(
      within(container).queryByRole("button", { name: "Expand the value of orderId" }),
    ).toBeNull()
    fireEvent.click(within(container).getByRole("button", { name: "Expand the value of customer" }))
    fireEvent.click(within(container).getByRole("button", { name: "Expand the value of items" }))

    expect([...container.querySelectorAll("pre")].map((block) => block.textContent)).toEqual([
      '{\n  "id": "C-77",\n  "tags": [\n    "b2b",\n    {}\n  ],\n  "address": {\n    "city": "Munich"\n  },\n  "empty": []\n}',
      VARIABLES[2]!.valueJson,
    ])
    fireEvent.click(
      within(container).getByRole("button", { name: "Collapse the value of customer" }),
    )
    expect(container.querySelectorAll("pre")).toHaveLength(1)
  })

  it("copies a value through the surface, names it and confirms the copy for a moment", () => {
    vi.useFakeTimers()
    const { slots, asked } = slotsOf()
    const { container } = render(
      <VariablesTable variables={VARIABLES} nameOf={nameOf} slots={slots} />,
    )

    fireEvent.click(
      within(container).getByRole("button", { name: "Copy value of items (cut off)" }),
    )
    const copied = within(container).getByRole("button", {
      name: "Copied value of items (cut off)",
    })

    expect(asked.copied).toEqual([
      { text: VARIABLES[2]!.valueJson, label: "value of items (cut off)" },
    ])
    expect(copied.title).toBe("Copied")
    act(() => {
      vi.advanceTimersByTime(1_500)
    })
    expect(
      within(container).getByRole("button", { name: "Copy value of items (cut off)" }),
    ).toBeTruthy()
  })
})

describe("an instance's variables read only", () => {
  it("keep a short value's copy button in the tab order and named, transparent at rest, never hidden", () => {
    const { container } = render(
      <VariablesTable
        variables={VARIABLES.slice(0, 1)}
        nameOf={nameOf}
        slots={editorInstanceSlots().slots}
      />,
    )
    const row = container.querySelector("tbody tr")
    const copy = within(container).getByRole("button", { name: "Copy value of orderId" })

    expect(row?.querySelectorAll("button")).toHaveLength(1)
    copy.focus()
    expect(document.activeElement).toBe(copy)
    expect(copy.className.split(" ")).toContain("opacity-0")
    expect(copy.className.split(" ")).toContain("focus-visible:opacity-100")
    expect(copy.className.split(" ")).not.toContain("invisible")
  })
})

describe("an instance's variables with an editor", () => {
  it("put the surface's note beside a name, its controls at a value's end and its editor in place", () => {
    type Row = (typeof VARIABLES)[number]
    const editor: VariableEditorSlot<Row> = {
      editing: (row) => (row.name === "customer" ? <span>editing customer</span> : undefined),
      controls: (row) =>
        row.editable === true ? <button type="button">Edit {row.name}</button> : null,
      note: (row) => (row.name === "items" ? <span data-testid="note">kept apart</span> : null),
    }
    const { container } = render(
      <VariablesTable
        variables={VARIABLES}
        nameOf={nameOf}
        editor={editor}
        slots={editorInstanceSlots().slots}
      />,
    )

    expect(cellsOf(container).map(([name, , value]) => [name, value])).toEqual([
      ["orderId", '"ORD-10442"Edit orderId'],
      ["customer", "editing customer"],
      ["itemskept apart", '[{"sku":"A-100","qty":2},{"sku":"B-220"cut off'],
    ])
  })

  it("speak German under a German locale", () => {
    const { container } = render(
      <LocaleProvider locale="de">
        <VariablesTable variables={VARIABLES} nameOf={nameOf} slots={editorInstanceSlots().slots} />
      </LocaleProvider>,
    )
    const table = within(container).getByRole("table", { name: "Variablen" })

    expect([...table.querySelectorAll("th")].map((head) => head.textContent)).toEqual([
      "Name",
      "Typ",
      "Wert",
      "Gültigkeitsbereich",
    ])
    expect(cellsOf(container)[0]?.[3]).toBe("Prozess")
    expect(
      within(container).getByRole("button", { name: "Wert von customer aufklappen" }),
    ).toBeTruthy()
    expect(
      within(container).getByRole("button", { name: "Wert von items (gekürzt) kopieren" }),
    ).toBeTruthy()
    cleanup()
    const empty = render(
      <LocaleProvider locale="de">
        <VariablesTable variables={[]} nameOf={nameOf} slots={editorInstanceSlots().slots} />
      </LocaleProvider>,
    )
    expect(empty.container.textContent).toContain("Diese Instanz hat keine Variablen.")
  })
})
