// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LocaleProvider } from "@miragon/mcp-toolkit-ui"
import { HostBridgeProvider, type HostBridge } from "@miragon/mcp-toolkit-ui/app"
import { FileSearch } from "lucide-react"
import { AskAiButton, type AskAiButtonProps } from "./ask-ai-button.js"
import { askAiPrompt, type AskAiPrompt } from "./ask-ai-prompt.js"

afterEach(cleanup)

function renderButton(
  prompt: AskAiPrompt | null,
  locale = "en",
  props: Omit<AskAiButtonProps, "prompt"> = {},
) {
  const sendFollowup = vi.fn()
  const bridge: HostBridge = {
    callTool: vi.fn(),
    sendFollowup,
    openExternal: vi.fn(),
    getWidgetData: () => null,
  }
  const view = render(
    <HostBridgeProvider bridge={bridge}>
      <LocaleProvider locale={locale}>
        <AskAiButton prompt={prompt} {...props} />
      </LocaleProvider>
    </HostBridgeProvider>,
  )
  return { ...view, sendFollowup }
}

const prompt = (locale = "en") =>
  askAiPrompt({
    intent: "Explain this.",
    locale,
    ids: { incidentId: "i1" },
    surface: { has: () => true },
  })

describe("AskAiButton", () => {
  it("posts the built hand-off unchanged as the follow-up", () => {
    const { sendFollowup } = renderButton(prompt())
    fireEvent.click(screen.getByRole("button", { name: "Analyze in chat" }))
    expect(sendFollowup).toHaveBeenCalledWith('Explain this.\nIds: incidentId="i1"')
  })

  it("renders nothing for a hand-off with nothing available in this deployment", () => {
    const { container } = renderButton(null)
    expect(container.querySelector("button")).toBeNull()
  })

  it("defaults its verb to the locale, a verb that names the chat", () => {
    renderButton(prompt("de"), "de")
    expect(screen.getByRole("button", { name: "Im Chat analysieren" })).toBeTruthy()
  })

  it("draws a decorative Lucide icon (default: the chat bubble), never the ✦ sparkle", () => {
    const { container } = renderButton(prompt())
    const svg = container.querySelector("svg")!
    expect(svg.getAttribute("class")).toContain("lucide-message-square")
    expect(svg.getAttribute("aria-hidden")).toBe("true")
    expect(container.textContent).not.toContain("✦")
  })

  it("shows the icon of the concrete function and the caller's verb", () => {
    const { container } = renderButton(prompt(), "en", {
      icon: FileSearch,
      label: "Explain in chat",
    })
    expect(screen.getByRole("button", { name: "Explain in chat" })).toBeTruthy()
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("lucide-file-search")
  })

  it("the icon variant moves the label into the accessible name and the tooltip", () => {
    const { container } = renderButton(prompt(), "en", {
      variant: "icon",
      label: "Draft a ticket in chat",
    })
    const button = screen.getByRole("button", { name: "Draft a ticket in chat" })
    expect(button.getAttribute("title")).toBe("Draft a ticket in chat")
    expect(button.textContent).toBe("")
    // A dense icon bar: the CI's narrower stroke, set on the icon itself.
    expect(container.querySelector("svg")!.getAttribute("stroke-width")).toBe("2")
  })

  it("the menuitem variant is a plain entry of a menu that posts the same hand-off", () => {
    const onSent = vi.fn()
    const { container, sendFollowup } = renderButton(prompt(), "en", {
      variant: "menuitem",
      icon: FileSearch,
      label: "Explain error in chat",
      onSent,
    })
    const item = screen.getByRole("menuitem", { name: "Explain error in chat" })
    expect(item.getAttribute("tabindex")).toBe("-1")
    // No button chrome: the menu's card is its surface (CI §8).
    expect(item.getAttribute("data-slot")).toBeNull()
    const classes = item.className.split(/\s+/)
    for (const role of [
      "rounded-sm",
      "text-dense",
      "hover:bg-accent",
      "disabled:opacity-50",
      "focus-visible:ring-inset",
    ]) {
      expect(classes, role).toContain(role)
    }
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("lucide-file-search")
    fireEvent.click(item)
    expect(sendFollowup).toHaveBeenCalledWith('Explain this.\nIds: incidentId="i1"')
    expect(onSent).toHaveBeenCalledTimes(1)
  })

  it("every variant is the same secondary outline, never a brand accent", () => {
    renderButton(prompt(), "en", { variant: "primary" })
    const button = screen.getByRole("button", { name: "Analyze in chat" })
    expect(button.className).not.toMatch(/text-info|text-link|bg-primary/)
  })
})
