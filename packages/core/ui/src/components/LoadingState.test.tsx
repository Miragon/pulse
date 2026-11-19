// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LocaleProvider } from "../locale/locale-provider.js"
import { UI_MESSAGES } from "../locale/ui-messages.js"
import { LoadingState } from "./LoadingState.js"

/** LoadingState, the webview's busy hint: a busy status with a spinner that stands still on request. */

afterEach(cleanup)

describe("LoadingState", () => {
  it("is a busy status saying the kit's words, the spinner decorative and still under reduced motion", () => {
    render(<LoadingState />)
    const status = screen.getByRole("status")
    expect(status.getAttribute("aria-busy")).toBe("true")
    expect(status.textContent).toBe(UI_MESSAGES.en.common.loading)
    const spinner = status.querySelector("svg")!
    expect(spinner.getAttribute("aria-hidden")).toBe("true")
    expect(spinner.getAttribute("width")).toBe("16")
    const c = spinner.getAttribute("class") ?? ""
    expect(c).toContain("motion-safe:animate-spin")
    expect(c).toContain("[.cd-shell-reduce-motion_&]:animate-none")
    expect(c).not.toMatch(/(^| )animate-spin/)
    // The compact empty state's geometry, so the content takes its place without a jump.
    expect(status.getAttribute("class")).toMatch(/(?=.*\bpy-6\b)(?=.*\bpx-3\b)(?=.*\btext-dense\b)/)
  })

  it("takes the caller's words and the locale's", () => {
    const { rerender } = render(<LoadingState>Loading instances…</LoadingState>)
    expect(screen.getByRole("status").textContent).toBe("Loading instances…")
    rerender(
      <LocaleProvider locale="de">
        <LoadingState />
      </LocaleProvider>,
    )
    expect(screen.getByRole("status").textContent).toBe(UI_MESSAGES.de.common.loading)
  })
})
