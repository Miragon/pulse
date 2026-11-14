// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { FileSearch } from "lucide-react"
import { AskAiButton, type AskAiButtonProps } from "./ask-ai-button.js"
import { askAiPrompt, type AskAiPrompt } from "./ask-ai-prompt.js"
import { TestViewHost, type HostAction } from "./test-view-host.js"
import type { FollowUp } from "./view-host.js"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderButton(
  prompt: AskAiPrompt | null,
  locale = "en",
  props: Omit<AskAiButtonProps, "prompt"> = {},
  followUp: FollowUp = "chat",
) {
  const actions: HostAction[] = []
  const view = render(
    <TestViewHost
      locale={locale}
      followUp={followUp}
      onHostAction={(action) => actions.push(action)}
    >
      <AskAiButton prompt={prompt} {...props} />
    </TestViewHost>,
  )
  return { ...view, actions }
}

/** The Clipboard API as the page has it: `writeText` resolves, or rejects when it is refused. */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => false })
}

const prompt = (locale = "en") =>
  askAiPrompt({
    intent: "Explain this.",
    locale,
    ids: { incidentId: "i1" },
  })

describe("AskAiButton", () => {
  it("posts the built hand-off unchanged as the follow-up", () => {
    const { actions } = renderButton(prompt())
    fireEvent.click(screen.getByRole("button", { name: "Analyze in chat" }))
    expect(actions).toEqual([
      { type: "sendFollowUp", prompt: 'Explain this.\nIds: incidentId="i1"' },
    ])
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
    // A 28 px icon button: the 16 px icon at the CI stroke, set on the icon itself.
    expect(button.className.split(" ")).toContain("size-control")
    const icon = container.querySelector("svg")!
    expect(icon.getAttribute("width")).toBe("16")
    expect(icon.getAttribute("stroke-width")).toBe("2.5")
  })

  it("xs is a table row's 24 px button, labelled or as an icon, so the row keeps its height", () => {
    renderButton(prompt(), "en", { variant: "icon", size: "xs", label: "Find the cause in chat" })
    const icon = screen.getByRole("button", { name: "Find the cause in chat" })
    expect(icon.className.split(" ")).toContain("size-control-xs")
    cleanup()
    renderButton(prompt(), "en", { size: "xs", label: "Find the cause in chat" })
    const labelled = screen.getByRole("button", { name: "Find the cause in chat" })
    expect(labelled.className.split(" ")).toContain("min-h-control-xs")
    expect(labelled.className.split(" ")).not.toContain("min-h-control")
  })

  it("the toolbar variant is the kit's toolbar button: the icon, then the label at 400 that a narrow bar hides visually", () => {
    const { container, actions } = renderButton(prompt(), "en", {
      variant: "toolbar",
      icon: FileSearch,
      label: "Explain error in chat",
    })
    const button = screen.getByRole("button", { name: "Explain error in chat" })
    expect(button.getAttribute("data-variant")).toBe("toolbar")
    const classes = button.className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(["min-h-control", "font-normal"]))
    expect(classes).not.toContain("font-semibold")
    expect(button.querySelector('[data-slot="button-label"]')?.textContent).toBe(
      "Explain error in chat",
    )
    expect(button.getAttribute("title")).toBe("Explain error in chat")
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("lucide-file-search")
    fireEvent.click(button)
    expect(actions).toEqual([
      { type: "sendFollowUp", prompt: 'Explain this.\nIds: incidentId="i1"' },
    ])
  })

  it("the menuitem variant is a plain entry of a menu that posts the same hand-off", () => {
    const onSent = vi.fn()
    const { container, actions } = renderButton(prompt(), "en", {
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
      "disabled:text-muted-foreground",
      "focus-visible:ring-inset",
    ]) {
      expect(classes, role).toContain(role)
    }
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("lucide-file-search")
    fireEvent.click(item)
    expect(actions).toEqual([
      { type: "sendFollowUp", prompt: 'Explain this.\nIds: incidentId="i1"' },
    ])
    expect(onSent).toHaveBeenCalledTimes(1)
  })

  it("every variant is the same secondary outline, never a brand accent", () => {
    renderButton(prompt(), "en", { variant: "primary" })
    const button = screen.getByRole("button", { name: "Analyze in chat" })
    expect(button.className).not.toMatch(/text-info|text-link|bg-primary/)
  })
})

describe("AskAiButton where the host posts to no chat", () => {
  it("shows no hand-off where the host shows none", () => {
    const { container } = renderButton(prompt(), "en", { variant: "toolbar" }, "none")
    expect(container.querySelector("button")).toBeNull()
  })

  it("copies the built prompt instead of posting it, and says so", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
    stubClipboard(writeText)
    const onSent = vi.fn()
    const { container, actions } = renderButton(
      prompt(),
      "en",
      { variant: "toolbar", icon: FileSearch, label: "Explain error in chat", onSent },
      "copy",
    )
    const button = screen.getByRole("button", { name: "Copy prompt: Explain error in chat" })
    expect(button.getAttribute("title")).toBe("Copy prompt: Explain error in chat")
    // The copy's own shape, not the chat function's.
    expect(container.querySelector("svg")!.getAttribute("class")).toContain("lucide-copy")
    fireEvent.click(button)
    expect(writeText).toHaveBeenCalledWith('Explain this.\nIds: incidentId="i1"')
    expect(await screen.findByText("Prompt copied. Paste it into your chat.")).toBeTruthy()
    expect(actions.filter((action) => action.type === "sendFollowUp")).toEqual([])
    expect(onSent).toHaveBeenCalledTimes(1)
  })

  it("names the copy after the hand-off's own title, in the view's language", () => {
    stubClipboard(() => Promise.resolve())
    renderButton(
      prompt("de"),
      "de",
      { variant: "icon", size: "xs", title: "Ursache im Chat klären: job-1" },
      "copy",
    )
    const button = screen.getByRole("button", {
      name: "Prompt kopieren: Ursache im Chat klären: job-1",
    })
    expect(button.getAttribute("title")).toBe("Prompt kopieren: Ursache im Chat klären: job-1")
  })

  it("is a menu's entry too, labelled with the hand-off it copies", () => {
    stubClipboard(() => Promise.resolve())
    renderButton(prompt(), "en", { variant: "menuitem", label: "Plan a fix in chat" }, "copy")
    expect(screen.getByRole("menuitem", { name: "Copy prompt: Plan a fix in chat" })).toBeTruthy()
  })

  it("says what to do where the page cannot write to the clipboard", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")))
    renderButton(prompt(), "en", {}, "copy")
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt: Analyze in chat" }))
    expect(await screen.findByText("Couldn't copy the prompt")).toBeTruthy()
    expect(
      screen.getByText(
        "This page can't write to the clipboard. Allow it in your browser and try again.",
      ),
    ).toBeTruthy()
  })
})
