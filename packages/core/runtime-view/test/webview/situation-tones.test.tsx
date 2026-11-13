import "../../src/webview/theme/cd-tokens.generated.css"
import "../../src/webview/styles/base.css"
import "../../src/webview/styles/components.css"
import { SITUATION_TONES, type Situation, type ToneVariant } from "@miragon/pulse-ui/tones"
import { render, type ComponentChild } from "preact"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { CountBadge, type CountBadgeProps } from "../../src/webview/components/count-badge.js"
import {
  IncidentFlag,
  StateLabel,
  type StateLabelProps,
} from "../../src/webview/components/state-label.js"

type Paint = "backgroundColor" | "borderTopColor"

const TONE_ROLES: Readonly<Record<ToneVariant, string>> = {
  danger: "--cd-ui-danger",
  warning: "--cd-ui-warning",
  success: "--cd-ui-success",
  info: "--cd-ui-info",
  neutral: "--cd-ui-text-leise",
}

const STATE_SITUATIONS: Readonly<Record<StateLabelProps["state"], Situation>> = {
  Running: "running",
  Suspended: "suspended",
  Completed: "ended",
  Cancelled: "ended",
  Incident: "openIncident",
}

const BADGE_SITUATIONS: Readonly<
  Record<CountBadgeProps["variant"], { readonly situation: Situation; readonly paint: Paint }>
> = {
  incident: { situation: "openIncident", paint: "backgroundColor" },
  propagated: { situation: "incidentInCalledInstance", paint: "borderTopColor" },
  running: { situation: "running", paint: "backgroundColor" },
}

const THEMES: readonly (readonly [theme: string, contrast: string | undefined])[] = [
  ["light", undefined],
  ["dark", undefined],
  ["light", "hoch"],
  ["dark", "hoch"],
]

const PALETTE_FILLS: Readonly<Record<"incident" | "running", string>> = {
  incident: "--cd-danger",
  running: "--cd-blau",
}

const host = document.createElement("div")

function useTheme(theme: string, contrast: string | undefined): void {
  const { dataset } = document.documentElement
  dataset.cdTheme = theme
  if (contrast === undefined) {
    delete dataset.cdKontrast
  } else {
    dataset.cdKontrast = contrast
  }
}

beforeAll(() => {
  useTheme("light", undefined)
  document.body.append(host)
})

afterAll(() => {
  render(null, host)
  host.remove()
  useTheme("light", undefined)
})

function colourOfVariable(variable: string): string {
  const probe = document.createElement("span")
  probe.style.color = `var(${variable})`
  host.append(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour
}

function colourOf(situation: Situation): string {
  return colourOfVariable(TONE_ROLES[SITUATION_TONES[situation]])
}

function rendered(node: ComponentChild): Element {
  render(node, host)
  const element = host.firstElementChild
  if (element === null) throw new Error("nothing rendered")
  return element
}

function iconColour(element: Element): string {
  const icon = element.querySelector(".icon")
  if (icon === null) throw new Error("no icon")
  return getComputedStyle(icon).color
}

describe.each(THEMES)("the webview's states in the %s theme, contrast %s", (theme, contrast) => {
  beforeAll(() => {
    useTheme(theme, contrast)
  })

  test.each(Object.entries(STATE_SITUATIONS))(
    "show the state %s in the tone of its situation",
    (state, situation) => {
      const label = rendered(<StateLabel state={state as StateLabelProps["state"]} />)
      expect(label.className).toContain(`state-label--${SITUATION_TONES[situation]}`)
      expect(iconColour(label)).toBe(colourOf(situation))
    },
  )

  test("flag an open incident in its tone", () => {
    expect(iconColour(rendered(<IncidentFlag />))).toBe(colourOf("openIncident"))
  })
})

describe("the webview's diagram badges", () => {
  beforeAll(() => {
    useTheme("light", undefined)
  })

  test.each(Object.entries(BADGE_SITUATIONS))(
    "paint the %s badge in the tone of its situation, in the light theme",
    (variant, { situation, paint }) => {
      const badge = rendered(
        <CountBadge variant={variant as CountBadgeProps["variant"]} count={3} />,
      )
      expect(getComputedStyle(badge)[paint]).toBe(colourOf(situation))
    },
  )

  test.each(Object.entries(PALETTE_FILLS))(
    "fill the %s badge with the palette's full colour under white text in the dark theme too",
    (variant, palette) => {
      useTheme("dark", undefined)
      const badge = rendered(
        <CountBadge variant={variant as CountBadgeProps["variant"]} count={3} />,
      )
      expect(getComputedStyle(badge).backgroundColor).toBe(colourOfVariable(palette))
      useTheme("light", undefined)
    },
  )
})
