// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { TestViewHost } from "./test-view-host.js"
import { ViewStack, type ViewComponent, type ViewMap } from "./views.js"
import { WidgetShell } from "./widget-shell.js"

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
    expect(stack?.className.split(" ").sort()).toEqual(
      ["flex", "flex-col", "gap-section", "min-w-0"].sort(),
    )
    expect([...(stack?.children ?? [])].map((child) => child.textContent)).toEqual(["one", "two"])
  })

  it("in a flush shell lets its rows touch: each is a view of its own with its gutter", () => {
    render(
      <WidgetShell flush>
        <ViewStack>
          <WidgetShell header={<header>bar</header>}>
            <p data-testid="first">one</p>
          </WidgetShell>
          <WidgetShell>
            <p data-testid="second">two</p>
          </WidgetShell>
        </ViewStack>
      </WidgetShell>,
    )
    const content = (id: string) => screen.getByTestId(id).parentElement!
    const stack = content("first").parentElement!.parentElement!
    expect(stack.className.split(" ").sort()).toEqual(["flex", "flex-col", "min-w-0"].sort())
    for (const id of ["first", "second"]) {
      expect(content(id).className.split(" ")).toEqual(
        expect.arrayContaining(["px-gutter", "py-3", "gap-section"]),
      )
    }
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

describe("ViewMap", () => {
  it("takes views of any data type under their show tool's name", () => {
    const Rows: ViewComponent<{ rows: string[] }> = ({ data }) => <p>{data.rows.join()}</p>
    const views = { demo_show_rows: Rows } satisfies ViewMap
    const View: ViewComponent = views.demo_show_rows
    const { container } = render(<View data={{ rows: ["a", "b"] } as never} />)
    expect(container.textContent).toBe("a,b")
  })
})
