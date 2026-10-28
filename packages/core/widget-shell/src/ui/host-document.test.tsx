// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LocaleProvider } from "@miragon/mcp-toolkit-ui"
import { SERVED_FONTS_STYLE_ID } from "./declare-served-fonts.js"
import { HostDocument } from "./host-document.js"
import { viewTitleMode } from "./localized-app-view.js"
import { BpmnZoomControls } from "./bpmn-zoom-controls.js"
import { ShellHostProvider, type ShellHost } from "./shell-host.js"

const BASE: ShellHost = { connected: true, displayMode: "inline", availableDisplayModes: [] }

function renderDocument(host: Partial<ShellHost>) {
  return render(
    <ShellHostProvider host={{ ...BASE, ...host }}>
      <HostDocument>
        <p data-testid="content">content</p>
      </HostDocument>
    </ShellHostProvider>,
  )
}

const wrapper = () => screen.getByTestId("content").parentElement!

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute("style")
  document.body.removeAttribute("style")
  document.getElementById("__mcp-host-fonts")?.remove()
  document.getElementById(SERVED_FONTS_STYLE_ID)?.remove()
  delete globalThis.__mcpUseViewConfig
})

describe("HostDocument", () => {
  it("lets an inline view size to its content — no box, no floor", () => {
    renderDocument({})
    expect(wrapper().style.display).toBe("contents")
    expect(wrapper().style.maxHeight).toBe("")
    expect(document.documentElement.style.height).toBe("")
  })

  it("scrolls inside the host's height budget instead of being clipped", () => {
    renderDocument({ maxHeight: 320 })
    expect(wrapper().style.maxHeight).toBe("320px")
    expect(wrapper().style.overflowY).toBe("auto")
  })

  it("fills the viewport in fullscreen and PiP, and restores the document on exit", () => {
    const { unmount } = renderDocument({ displayMode: "fullscreen", maxHeight: 320 })
    expect(document.documentElement.style.height).toBe("100%")
    expect(document.body.style.minHeight).toBe("100%")
    expect(wrapper().style.display).toBe("flex")
    unmount()
    expect(document.documentElement.style.height).toBe("")

    renderDocument({ displayMode: "pip" })
    expect(document.body.style.height).toBe("100%")
  })

  it("applies the host's style variables to <html> and injects its font CSS once", () => {
    renderDocument({
      styleVariables: {
        "--color-text-primary": "#f5f4ef",
        "--font-sans": "HostSans",
        "--font-mono": undefined,
      },
      fontCss: "@font-face { font-family: HostSans; src: local(Arial); }",
    })
    const style = document.documentElement.style
    expect(style.getPropertyValue("--color-text-primary")).toBe("#f5f4ef")
    // Geist stays first; the host's font moves into the fallback slot.
    expect(style.getPropertyValue("--host-font-sans")).toBe("HostSans")
    expect(style.getPropertyValue("--font-sans")).toBe("")
    expect(style.getPropertyValue("--host-font-mono")).toBe("")
    expect(style.getPropertyValue("--font-mono")).toBe("")
    cleanup()
    renderDocument({ fontCss: "@font-face { font-family: Other; src: local(Arial); }" })
    expect(document.querySelectorAll("#__mcp-host-fonts")).toHaveLength(1)
  })

  it("declares Geist from the server that served the view, before the host's font", () => {
    globalThis.__mcpUseViewConfig = { publicBase: "https://mcp.example.com/mcp/_mcp-use/public/" }
    renderDocument({ fontCss: "@font-face { font-family: HostSans; src: local(Arial); }" })
    const served = document.getElementById(SERVED_FONTS_STYLE_ID)!
    expect(served.textContent).toContain(
      'url("https://mcp.example.com/fonts/geist-5.3.0/geist-latin-wght-normal.woff2")',
    )
    const styles = [...document.head.querySelectorAll("style")].map((style) => style.id)
    expect(styles.indexOf(SERVED_FONTS_STYLE_ID)).toBeLessThan(styles.indexOf("__mcp-host-fonts"))
  })

  it("declares no face outside a served view document", () => {
    renderDocument({})
    expect(document.getElementById(SERVED_FONTS_STYLE_ID)).toBeNull()
  })
})

describe("viewTitleMode (one title per view)", () => {
  it("hides the toolbar title over a module's view, whose widget renders its own heading", () => {
    for (const tool of [
      "camunda7_show_process_list",
      "camunda7_open_cockpit",
      "analytics_show_dashboard",
      "notes_show_list",
    ]) {
      expect(viewTitleMode(tool)).toBe("hide")
    }
  })

  it("keeps it over a composed render-view and where the host does not name the tool", () => {
    expect(viewTitleMode("render-view")).toBe("show")
    expect(viewTitleMode(undefined)).toBe("show")
  })
})

describe("BpmnZoomControls", () => {
  const noop = () => {}

  it("names its buttons in the active locale, overridable per prop", () => {
    render(
      <LocaleProvider locale="de">
        <BpmnZoomControls
          onZoomIn={noop}
          onZoomOut={noop}
          onFit={noop}
          labels={{ fit: "Passend" }}
        />
      </LocaleProvider>,
    )
    expect(screen.getByRole("button", { name: "Vergrößern" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Verkleinern" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Passend" })).toBeTruthy()
  })

  it("sits top-right, clear of the bpmn.io logo bpmn-js pins bottom-right", () => {
    render(<BpmnZoomControls onZoomIn={noop} onZoomOut={noop} onFit={noop} />)
    const bar = screen.getByRole("button", { name: "Zoom in" }).parentElement!
    expect(bar.className).toContain("top-3")
    expect(bar.className).not.toContain("bottom-")
  })
})
