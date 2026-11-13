// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LOG_TEXT_PREVIEW, LogText, TEXT_BLOCK_FRAME } from "./log-text.js"

afterEach(cleanup)

describe("LogText: one truncation policy for engine text", () => {
  it("shows a dash for no text", () => {
    for (const text of [null, undefined, ""]) {
      const { container } = render(<LogText text={text} />)
      expect(container.textContent).toBe("—")
      cleanup()
    }
  })

  it("shows short text whole, without a disclosure", () => {
    const { container } = render(<LogText text="NullPointerException" />)
    expect(container.querySelector("details")).toBeNull()
    expect(screen.getByText("NullPointerException").tagName).toBe("P")
  })

  it("cuts long text at the preview and keeps the whole of it in a scrolling disclosure", () => {
    const text = "x".repeat(LOG_TEXT_PREVIEW + 40)
    const { container } = render(<LogText text={text} className="mt-2" />)
    const details = container.querySelector("details")
    expect(details?.getAttribute("class")).toBe("mt-2")
    expect(details?.querySelector("summary")?.textContent).toBe(`${"x".repeat(LOG_TEXT_PREVIEW)}…`)
    const pre = details?.querySelector("pre")
    expect(pre?.textContent).toBe(text)
    for (const c of TEXT_BLOCK_FRAME.split(" ")) expect(pre?.getAttribute("class")).toContain(c)
  })
})
