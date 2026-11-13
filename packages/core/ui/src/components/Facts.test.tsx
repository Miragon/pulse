// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { CopyableId } from "./CopyableId.js"
import { Facts } from "./Facts.js"

/** Facts, the webview's incident facts: a description list of terms and their values. */

afterEach(cleanup)

const classes = (el: Element | null | undefined) => (el?.getAttribute("class") ?? "").split(/\s+/)

describe("Facts", () => {
  it("is a description list on a two-column grid: quiet terms, values in the foreground", () => {
    const { container } = render(
      <Facts
        facts={[
          { label: "Root cause", value: "NullPointerException", mono: true, emphasis: true },
          { label: "Retries left", value: "0" },
        ]}
      />,
    )
    const list = container.querySelector("dl")
    expect(list?.getAttribute("data-slot")).toBe("facts")
    expect(classes(list)).toEqual(
      expect.arrayContaining([
        "grid",
        "grid-cols-[max-content_minmax(0,1fr)]",
        "gap-x-4",
        "gap-y-1",
        "text-dense",
      ]),
    )
    const terms = screen.getAllByRole("term")
    const values = screen.getAllByRole("definition")
    expect(terms.map((t) => t.textContent)).toEqual(["Root cause", "Retries left"])
    expect(values.map((v) => v.textContent)).toEqual(["NullPointerException", "0"])
    expect(classes(terms[0])).toEqual(
      expect.arrayContaining(["text-small", "text-muted-foreground"]),
    )
    // A value wraps anywhere instead of widening the view; parts of it 4 px apart.
    expect(classes(values[0])).toEqual(
      expect.arrayContaining([
        "[overflow-wrap:anywhere]",
        "flex-wrap",
        "gap-1",
        "font-mono",
        "font-semibold",
      ]),
    )
    expect(classes(values[1])).not.toContain("font-mono")
    expect(classes(values[1])).not.toContain("font-semibold")
  })

  it("holds an id with its copy button, which shows there always", () => {
    render(
      <Facts
        facts={[
          {
            label: "Incident",
            value: (
              <CopyableId
                id="7f0c1d2e-3b4a-5c6d-7e8f-9a0b1c2d3e4f"
                label="incident ID"
                onCopy={vi.fn()}
              />
            ),
          },
        ]}
      />,
    )
    const value = screen.getByRole("definition")
    const copy = within(value).getByRole("button", { name: "Copy incident ID" })
    expect(classes(copy)).toContain("[[data-slot=facts]_&]:opacity-100")
  })

  it("keys by an id, else by the label's text, else by place", () => {
    const { container } = render(
      <Facts
        facts={[
          { id: "a", label: <span>Job</span>, value: "1" },
          { label: <span>Job</span>, value: "2" },
          { label: "Message", value: "3" },
        ]}
      />,
    )
    expect(container.querySelectorAll("dt")).toHaveLength(3)
  })
})
