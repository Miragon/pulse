// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { useDiagramMaxHeight } from "./inline-budget.js"
import { TestViewHost } from "./test-view-host.js"

afterEach(cleanup)

function Probe() {
  return <p>{String(useDiagramMaxHeight())}</p>
}

/** What a view hands pulse-ui's BPMN diagram, which knows no host: the inline card's budget. */
describe("useDiagramMaxHeight", () => {
  it("caps a diagram at 320 px inline in a chat", () => {
    render(
      <TestViewHost>
        <Probe />
      </TestViewHost>,
    )
    expect(screen.getByText("320")).toBeTruthy()
  })

  it("leaves a diagram its own height in fullscreen", () => {
    render(
      <TestViewHost host={{ displayMode: "fullscreen" }}>
        <Probe />
      </TestViewHost>,
    )
    expect(screen.getByText("null")).toBeTruthy()
  })
})
