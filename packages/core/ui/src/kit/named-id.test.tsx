// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { DataTable } from "./data-table.js"
import { NamedId, NamedIdLayoutContext } from "./named-id.js"

afterEach(cleanup)

/** #322 U13: ONE look in every module. Outside a table it stacks. */
describe("NamedId, stacked (outside tables)", () => {
  it("puts the name first, dense and 600, and the id quietly below in mono", () => {
    const { container } = render(<NamedId name="Bike Leasing" id="miraveloLeasing" />)
    const [nameLine, idLine] = Array.from(container.firstElementChild?.children ?? [])
    expect(nameLine.textContent).toBe("Bike Leasing")
    expect(nameLine.className).toContain("font-semibold")
    expect(nameLine.className).toContain("text-dense")
    expect(idLine.className).toContain("text-small")
    expect(idLine.className).toContain("text-muted-foreground")
    const id = container.querySelector(".font-mono")
    expect(id?.textContent).toBe("miraveloLeasing")
    // A long id wraps between its parts, never in the middle of a word.
    expect(id?.className).not.toContain("break-all")
    // A part wider than the column still wraps inside itself, never widening it.
    expect(id?.className).toContain("wrap-anywhere")
    expect(id?.innerHTML).toBe("miravelo<wbr>Leasing")
  })

  it("appends the details to the id line, skipping empty ones", () => {
    const { container } = render(
      <NamedId name="Pack" id="Task_A" detail={["User task", null, "", "Order"]} />,
    )
    expect(container.textContent).toBe("PackTask_A · User task · Order")
    expect(container.querySelector(".font-mono")?.textContent).toBe("Task_A")
  })

  it("lets the id lead in mono when no name is known, and shows no empty line", () => {
    for (const name of [null, undefined, ""]) {
      const { container } = render(<NamedId name={name} id="order" />)
      expect(container.textContent).toBe("order")
      expect(container.querySelector(".font-mono")?.textContent).toBe("order")
      expect(container.querySelectorAll(".text-small")).toHaveLength(0)
      cleanup()
    }
  })

  it("shows a name that only repeats the id once, as the id", () => {
    const { container } = render(<NamedId name="order" id="order" />)
    expect(container.textContent).toBe("order")
    expect(container.querySelectorAll(".font-mono")).toHaveLength(1)
  })

  it("puts the details under a leading id without a separator in front", () => {
    const { container } = render(<NamedId name={null} id="Task_A" detail={["User task"]} />)
    expect(container.textContent).toBe("Task_AUser task")
  })

  it("puts the lead before the name on its line", () => {
    const { getByTestId } = render(
      <NamedId name="Order" id="order" lead={<span data-testid="dot" />} />,
    )
    expect(getByTestId("dot").nextElementSibling?.textContent).toBe("Order")
  })
})

/**
 * In a table cell the id keeps its row at the row height: one line, the name, then the short id
 * in mono and quiet, cut with an ellipsis, the whole in the title and for a screen reader.
 */
describe("NamedId, inline (in table cells)", () => {
  const UUID = "5f0ce78e-1c2b-4d3e-9f00-123456789abc"

  it("puts the name, then the id in mono and quiet, on one line that truncates", () => {
    const { container } = render(
      <NamedId name="Bike Leasing" id="miraveloLeasing" layout="inline" />,
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.getAttribute("data-named-id")).toBe("inline")
    expect(root.className).not.toContain("flex-col")
    const line = root.querySelector(".truncate") as HTMLElement
    expect(line.className).toContain("text-dense")
    expect(line.className).toContain("min-w-0")
    expect(line.textContent).toBe("Bike Leasing miraveloLeasing")
    const id = line.querySelector(".font-mono") as HTMLElement
    expect(id.textContent).toBe("miraveloLeasing")
    expect(id.className).toContain("text-muted-foreground")
    // One line: no break points inside the id.
    expect(root.querySelector("wbr")).toBeNull()
    expect(line.getAttribute("title")).toBe("Bike Leasing · miraveloLeasing")
    // No cap of its own: as wide as its text where there is room, down to the floor a table's
    // layout reads as its narrowest (8rem unless the table says otherwise).
    expect(root.className).not.toContain("max-w-")
    const track = line.parentElement as HTMLElement
    expect(track.className).toContain("grid")
    expect(track.className).toContain("grid-cols-[minmax(var(--named-id-floor,8rem),max-content)]")
  })

  it("shows a long id short, the whole id in the title and for a screen reader", () => {
    const { container } = render(<NamedId name="Order" id={UUID} layout="inline" />)
    const id = container.querySelector(".font-mono") as HTMLElement
    expect(id.querySelector("[aria-hidden='true']")?.textContent).toBe("5f0ce78e…")
    expect(id.querySelector(".sr-only")?.textContent).toBe(UUID)
    expect(container.querySelector("[title]")?.getAttribute("title")).toBe(`Order · ${UUID}`)
  })

  it("lets the id lead in the foreground without a name, the details after it", () => {
    const { container } = render(
      <NamedId name={null} id="Task_A" detail={["User task", null, ""]} layout="inline" />,
    )
    expect(container.textContent).toBe("Task_A · User task")
    const id = container.querySelector(".font-mono") as HTMLElement
    expect(id.className).toContain("text-foreground")
    expect(container.querySelector("[title]")?.getAttribute("title")).toBe("Task_A · User task")
  })

  it("keeps the lead before the line", () => {
    const { getByTestId } = render(
      <NamedId name="Order" id="order" layout="inline" lead={<span data-testid="dot" />} />,
    )
    expect(getByTestId("dot").nextElementSibling?.textContent).toBe("Order order")
    expect(getByTestId("dot").nextElementSibling?.querySelector(".truncate")).toBeTruthy()
  })

  it("takes the inline layout from a table's body, and stacks again where asked", () => {
    render(
      <DataTable label="Processes" columns={[{ key: "process", label: "Process" }]}>
        <tr>
          <td>
            <NamedId name="Bike Leasing" id="miraveloLeasing" />
          </td>
          <td>
            <NamedId name="Order" id="order" layout="stacked" />
          </td>
        </tr>
      </DataTable>,
    )
    const [inCell, asked] = Array.from(document.querySelectorAll("[data-named-id]"))
    expect(inCell?.getAttribute("data-named-id")).toBe("inline")
    expect(asked?.getAttribute("data-named-id")).toBe("stacked")
  })

  it("stacks by default, outside any table", () => {
    const { container } = render(
      <NamedIdLayoutContext.Provider value="stacked">
        <NamedId name="Order" id="order" />
      </NamedIdLayoutContext.Provider>,
    )
    expect(container.firstElementChild?.getAttribute("data-named-id")).toBe("stacked")
  })
})
