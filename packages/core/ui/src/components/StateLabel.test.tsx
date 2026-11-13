// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { TONE_ICON } from "../lib/tone-utils.js"
import { LocaleProvider } from "../locale/locale-provider.js"
import { UI_MESSAGES } from "../locale/ui-messages.js"
import { SITUATION_TONES } from "../tones/index.js"
import { StateLabel, type StateLabelState } from "./StateLabel.js"

/** StateLabel, the webview's state label: a tone icon of its own shape and the state's one word. */

afterEach(cleanup)

const STATES: readonly StateLabelState[] = [
  "running",
  "suspended",
  "completed",
  "cancelled",
  "ended",
  "incident",
]

const TONES: Readonly<Record<StateLabelState, string>> = {
  running: SITUATION_TONES.running,
  suspended: SITUATION_TONES.suspended,
  completed: SITUATION_TONES.ended,
  cancelled: SITUATION_TONES.ended,
  ended: SITUATION_TONES.ended,
  incident: SITUATION_TONES.openIncident,
}

describe("StateLabel", () => {
  it.each(STATES)(
    "%s: a 16 px icon in its situation's tone, the kit's word in the foreground, no pill",
    (state) => {
      const { container } = render(<StateLabel state={state} />)
      const label = container.querySelector('[data-slot="state-label"]')!
      expect(label.getAttribute("data-tone")).toBe(TONES[state])
      expect(label.textContent).toBe(UI_MESSAGES.en.stateLabel[state])
      const icon = label.querySelector("svg")!
      expect(icon.getAttribute("width")).toBe("16")
      expect(icon.getAttribute("aria-hidden")).toBe("true")
      expect(icon.getAttribute("class")).toContain(
        TONE_ICON[TONES[state] as keyof typeof TONE_ICON],
      )
      expect(label.querySelector("span")?.getAttribute("class")).toContain("text-foreground")
      expect(label.getAttribute("class")).not.toMatch(/\b(border|rounded|bg-)/)
    },
  )

  it("gives every state an icon of its own shape", () => {
    const shapes = STATES.map((state) => {
      const { container } = render(<StateLabel state={state} />)
      return container.querySelector("svg")?.innerHTML
    })
    expect(new Set(shapes).size).toBe(STATES.length)
  })

  it("speaks the locale, one word per state, and takes other words", () => {
    render(
      <LocaleProvider locale="de">
        <StateLabel state="cancelled" />
        <StateLabel state="running">Running since 9:05</StateLabel>
      </LocaleProvider>,
    )
    expect(screen.getByText("Abgebrochen").closest("[title]")?.getAttribute("title")).toBe(
      "Abgebrochen",
    )
    expect(screen.getByText("Running since 9:05")).toBeTruthy()
    expect(new Set(Object.values(UI_MESSAGES.en.stateLabel)).size).toBe(STATES.length)
  })
})
