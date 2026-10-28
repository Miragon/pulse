// @vitest-environment happy-dom
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render as rtlRender, screen } from "@testing-library/react"
import { LocaleProvider } from "@miragon/mcp-toolkit-ui"
import { HostBridgeProvider, type HostBridge } from "@miragon/mcp-toolkit-ui/app"
import { askAiPrompt } from "./ask-ai-prompt.js"
import { HAND_OFF_ACTIONS, HandOffButton, type HandOffAction } from "./hand-off-button.js"
import { KIT_LABELS } from "./kit-labels.js"

afterEach(cleanup)

const bridge: HostBridge = {
  callTool: vi.fn(),
  sendFollowup: vi.fn(),
  openExternal: vi.fn(),
  getWidgetData: () => null,
}

const render = (ui: ReactNode) =>
  rtlRender(<HostBridgeProvider bridge={bridge}>{ui}</HostBridgeProvider>)

const prompt = askAiPrompt({
  intent: "Explain this.",
  locale: "en",
  ids: { incidentId: "i1" },
  surface: { has: () => true },
})

const lucideClass = (name: string) =>
  `lucide-${name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`

const ACTIONS = Object.keys(HAND_OFF_ACTIONS) as HandOffAction[]

describe("HandOffButton: one icon and one verb per function, in every module", () => {
  it.each(ACTIONS.flatMap((action) => [[action, "en"] as const, [action, "de"] as const]))(
    "%s (%s)",
    (action, locale) => {
      const label = KIT_LABELS[locale].handOff[action]
      // Every label says where the work happens.
      expect(label).toMatch(locale === "de" ? /im Chat/i : / in chat$/)
      const { container } = render(
        <LocaleProvider locale={locale}>
          <HandOffButton action={action} prompt={prompt} />
        </LocaleProvider>,
      )
      expect(screen.getByRole("button", { name: label })).toBeTruthy()
      const svg = container.querySelector("svg")!
      expect(svg.getAttribute("class")).toContain(
        lucideClass(HAND_OFF_ACTIONS[action].displayName!),
      )
      expect(svg.getAttribute("aria-hidden")).toBe("true")
    },
  )

  it("labels every function in both languages, and no two functions alike", () => {
    for (const labels of [KIT_LABELS.de.handOff, KIT_LABELS.en.handOff]) {
      expect(Object.keys(labels).sort()).toEqual([...ACTIONS].sort())
      expect(new Set(Object.values(labels)).size).toBe(ACTIONS.length)
    }
  })

  it("no two functions share an icon (two hand-offs in one row stay distinguishable)", () => {
    const icons = Object.values(HAND_OFF_ACTIONS)
    expect(new Set(icons).size).toBe(icons.length)
  })

  // Owner-decided wording (#322 U5): a hand-off never looks like an engine action.
  it.each([
    ["assess", "Im Chat bewerten", "Assess in chat"],
    ["findCause", "Ursache im Chat klären", "Find cause in chat"],
    ["planFix", "Behebung im Chat planen", "Plan a fix in chat"],
    ["explainError", "Fehler im Chat erklären", "Explain error in chat"],
    ["draftTicket", "Ticket im Chat entwerfen", "Draft ticket in chat"],
  ] as const)("the decided wording: %s", (action, german, english) => {
    expect(KIT_LABELS.de.handOff[action]).toBe(german)
    expect(KIT_LABELS.en.handOff[action]).toBe(english)
  })

  it("an icon-only row keeps the label as the accessible name and tooltip", () => {
    render(
      <LocaleProvider locale="de">
        <HandOffButton action="draftTicket" variant="icon" prompt={prompt} />
      </LocaleProvider>,
    )
    const button = screen.getByRole("button", { name: "Ticket im Chat entwerfen" })
    expect(button.getAttribute("title")).toBe("Ticket im Chat entwerfen")
    expect(button.textContent).toBe("")
  })

  it("a row title names its subject in the accessible name and tooltip", () => {
    render(
      <LocaleProvider locale="en">
        <HandOffButton
          action="compareEngines"
          variant="icon"
          title="Compare “order” across its engines in chat"
          prompt={prompt}
        />
      </LocaleProvider>,
    )
    const button = screen.getByRole("button", {
      name: "Compare “order” across its engines in chat",
    })
    expect(button.getAttribute("title")).toBe("Compare “order” across its engines in chat")
  })

  it("renders nothing for a hand-off this deployment cannot offer", () => {
    const { container } = render(<HandOffButton action="planFix" prompt={null} />)
    expect(container.querySelector("button")).toBeNull()
  })
})
