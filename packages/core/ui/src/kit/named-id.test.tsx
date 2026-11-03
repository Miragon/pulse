// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { NamedId } from "./named-id.js"

afterEach(cleanup)

/** #322 U13: ONE look in every module. */
describe("NamedId", () => {
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
