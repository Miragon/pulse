// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { buttonVariants } from "@miragon/pulse-ui"
import { OpenInCockpitLink } from "./open-in-cockpit-link.js"
import { TestViewHost, type HostAction } from "./test-view-host.js"

/** widget-shell's own tone-aware pieces; pulse-ui's components are pinned by its own suites. */

afterEach(cleanup)

describe("OpenInCockpitLink", () => {
  function renderLink(
    locale: string,
    props: { vendor?: string; label?: string; variant?: "outline" | "menuitem" },
  ) {
    const openExternal = vi.fn()
    const onHostAction = (action: HostAction) => {
      if (action.type === "openExternal") openExternal(action.url)
    }
    render(
      <TestViewHost locale={locale} onHostAction={onHostAction}>
        <OpenInCockpitLink url="https://engine.example/cockpit" {...props} />
      </TestViewHost>,
    )
    return openExternal
  }

  it("is named after the vendor and says that it opens a new tab", () => {
    renderLink("de", { vendor: "CIB seven" })
    const link = screen.getByRole("link", { name: "In CIB seven öffnen, öffnet in neuem Tab" })
    expect(link.textContent).toBe("In CIB seven öffnen")
    expect(link.querySelector("svg.lucide-external-link")?.getAttribute("aria-hidden")).toBe("true")
    expect(link.className).not.toContain("text-muted-foreground")
    // One action size with the buttons beside it: the kit's outline button, sm.
    expect(link.className).toBe(buttonVariants({ variant: "outline", size: "sm" }))
  })

  it("falls back to the engine cockpit and honours a caller's label, in English", () => {
    renderLink("en", {})
    expect(
      screen.getByRole("link", { name: "Open in engine cockpit (opens in a new tab)" }),
    ).toBeTruthy()
    cleanup()
    const openExternal = renderLink("en", {
      label: "Open instance in Camunda 7",
      vendor: "Camunda 7",
    })
    const link = screen.getByRole("link", {
      name: "Open instance in Camunda 7 (opens in a new tab)",
    })
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith("https://engine.example/cockpit")
  })

  it("as a menu entry: the same link and name, its icon in front, no outline", () => {
    const openExternal = renderLink("de", { vendor: "CIB seven", variant: "menuitem" })
    const item = screen.getByRole("menuitem", { name: "In CIB seven öffnen, öffnet in neuem Tab" })
    expect(item.tagName).toBe("A")
    expect(item.getAttribute("href")).toBe("https://engine.example/cockpit")
    expect(item.getAttribute("tabindex")).toBe("-1")
    expect(item.firstElementChild?.getAttribute("class")).toContain("lucide-external-link")
    expect(item.className).not.toContain("border-border")
    fireEvent.click(item)
    expect(openExternal).toHaveBeenCalledWith("https://engine.example/cockpit")
  })
})
