// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { HostWidgetSlot } from "./host-widgets.js"
import { TestViewHost } from "./test-view-host.js"
import { ViewStack, type ViewComponent, type ViewMap } from "./views.js"

afterEach(cleanup)

describe("ViewStack", () => {
  it("stacks full-width rows that may shrink, so a wide table scrolls in its own region", () => {
    const { container } = render(
      <ViewStack>
        <p>one</p>
        <p>two</p>
      </ViewStack>,
    )
    const stack = container.firstElementChild
    expect(stack?.className.split(" ")).toEqual(["flex", "min-w-0", "flex-col", "gap-4"])
    expect([...(stack?.children ?? [])].map((child) => child.textContent)).toEqual(["one", "two"])
  })

  it("keeps a crashing row inside its own boundary: the rows around it stay", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const Broken = () => {
      throw new Error("row bug")
    }
    render(
      <TestViewHost locale="en">
        <ViewStack>
          <p>first</p>
          {null}
          <Broken />
          <p>last</p>
        </ViewStack>
      </TestViewHost>,
    )
    expect(screen.getByText("first")).toBeTruthy()
    expect(screen.getByText("This element couldn't be displayed.")).toBeTruthy()
    expect(screen.getByText("last")).toBeTruthy()
    error.mockRestore()
  })
})

describe("HostWidgetSlot", () => {
  it("keeps another module's crashing widget inside the slot", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const Broken = () => {
      throw new Error("landscape bug")
    }
    render(
      <TestViewHost locale="en" hostWidgets={{ "other:landscape": Broken }}>
        <p>fleet</p>
        <HostWidgetSlot id="other:landscape" />
      </TestViewHost>,
    )
    expect(screen.getByText("fleet")).toBeTruthy()
    expect(screen.getByText("This element couldn't be displayed.")).toBeTruthy()
    error.mockRestore()
  })
})

describe("ViewMap", () => {
  it("takes views of any data type under their show tool's name", () => {
    const Rows: ViewComponent<{ rows: string[] }> = ({ data }) => <p>{data.rows.join()}</p>
    const views = { demo_show_rows: Rows } satisfies ViewMap
    const View: ViewComponent = views.demo_show_rows
    const { container } = render(<View data={{ rows: ["a", "b"] } as never} />)
    expect(container.textContent).toBe("a,b")
  })
})
