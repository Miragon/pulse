import { SITUATION_TONES, type Situation, type ToneVariant } from "@miragon/pulse-ui/tones"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import type {
  DefinitionView,
  InstanceRow,
  InstanceStateLabel,
} from "../../src/core/protocol/index.js"
import { CountBadge, type CountBadgeProps } from "../../src/webview/components/count-badge.js"
import { DEFINITION_VIEW } from "../../dev/webview/fixtures/definition.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import {
  allParts,
  findRole,
  mount,
  mountApp,
  nextFrame,
  queryPart,
  type Harness,
  type Mounted,
  type Renderable,
} from "./harness.js"

type Paint = "backgroundColor" | "borderTopColor"

const TONE_ROLES: Readonly<Record<ToneVariant, string>> = {
  danger: "--cd-ui-danger",
  warning: "--cd-ui-warning",
  success: "--cd-ui-success",
  info: "--cd-ui-info",
  neutral: "--cd-ui-text-leise",
}

const STATE_SITUATIONS: Readonly<Record<InstanceStateLabel, Situation>> = {
  Running: "running",
  Suspended: "suspended",
  Completed: "ended",
  Cancelled: "ended",
}

const STATE_IDS: Readonly<Record<InstanceStateLabel, string>> = {
  Running: "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  Suspended: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  Completed: "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
  Cancelled: "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b",
}

const STATES_VIEW: DefinitionView = {
  ...DEFINITION_VIEW,
  instances: Object.entries(STATE_IDS).map(([state, id]): InstanceRow => ({
    id,
    shortId: `${id.slice(0, 8)}…`,
    businessKey: `TONE-${state}`,
    state: state as InstanceStateLabel,
    hasIncident: state === "Running",
    startedAt: DEFINITION_VIEW.asOf,
  })),
  hasMoreInstances: false,
  filter: { scope: "all" },
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
let mounted: Mounted | undefined

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
  mounted?.unmount()
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

function channels(colour: string): string {
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(colour)
  const values =
    srgb === null
      ? (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      : srgb.slice(1).map((value) => Number(value) * 255)
  return values.map((value) => Math.round(value)).join(",")
}

function colourOf(situation: Situation): string {
  return channels(colourOfVariable(TONE_ROLES[SITUATION_TONES[situation]]))
}

async function rendered(node: Renderable): Promise<HTMLElement> {
  if (mounted === undefined) {
    mounted = mount(node, host)
  } else {
    mounted.update(node)
  }
  await nextFrame()
  const element = host.firstElementChild
  if (!(element instanceof HTMLElement)) throw new Error("nothing rendered")
  return element
}

function iconColour(element: Element): string {
  const icon = element.querySelector("svg")
  if (icon === null) throw new Error("no icon")
  return channels(getComputedStyle(icon).color)
}

function rowOf(table: HTMLTableElement, businessKey: string): HTMLTableRowElement {
  const row = [...(table.tBodies[0]?.rows ?? [])].find((candidate) =>
    candidate.textContent.includes(businessKey),
  )
  if (row === undefined) throw new Error(`no row ${businessKey}`)
  return row
}

describe.each(THEMES)(
  "the definition view's instance states in the %s theme, contrast %s",
  (theme, contrast) => {
    let harness: Harness | undefined
    let table: HTMLTableElement

    beforeAll(async () => {
      harness = mountApp()
      harness.publish({ status: "ready", view: STATES_VIEW, refreshing: false })
      table = await findRole<HTMLTableElement>(harness.root, "table", { name: "Instances" })
      useTheme(theme, contrast)
      await nextFrame()
    })

    afterAll(() => {
      harness?.unmount()
      useTheme("light", undefined)
    })

    test.each(Object.entries(STATE_SITUATIONS))(
      "show the state %s in the tone of its situation",
      (state, situation) => {
        const label = queryPart(rowOf(table, `TONE-${state}`), "state-label")!
        expect(label.textContent).toBe(state)
        expect(label.dataset.tone).toBe(SITUATION_TONES[situation])
        expect(iconColour(label)).toBe(colourOf(situation))
      },
    )

    test("flag an open incident in its tone, beside the state", () => {
      const flags = allParts(table, "incident-flag")
      const flag = queryPart(rowOf(table, "TONE-Running"), "incident-flag")!
      expect(flags).toEqual([flag])
      expect(flag.dataset.tone).toBe(SITUATION_TONES.openIncident)
      expect(iconColour(flag)).toBe(colourOf("openIncident"))
    })
  },
)

describe("the webview's diagram badges", () => {
  beforeAll(() => {
    useTheme("light", undefined)
  })

  test.each(Object.entries(BADGE_SITUATIONS))(
    "paint the %s badge in the tone of its situation, in the light theme",
    async (variant, { situation, paint }) => {
      const badge = await rendered(
        <CountBadge variant={variant as CountBadgeProps["variant"]} count={3} />,
      )
      expect(channels(getComputedStyle(badge)[paint])).toBe(colourOf(situation))
    },
  )

  test.each(Object.entries(PALETTE_FILLS))(
    "fill the %s badge with the palette's full colour under white text in the dark theme too",
    async (variant, palette) => {
      useTheme("dark", undefined)
      const badge = await rendered(
        <CountBadge variant={variant as CountBadgeProps["variant"]} count={3} />,
      )
      expect(getComputedStyle(badge).backgroundColor).toBe(colourOfVariable(palette))
      useTheme("light", undefined)
    },
  )
})

describe("the counts of an engine that stops counting", () => {
  beforeAll(() => {
    useTheme("light", undefined)
  })

  test("keep the tone of their situation: a lower bound neutral, the instances with incident in theirs", async () => {
    const harness = mountApp()
    harness.publish(FIXTURES["definition-camunda8"])
    const group = await findRole(harness.root, "radiogroup", { name: "Show instances" })
    await nextFrame()

    const counts = allParts(group, "segment-count")
    const toned = counts.filter((count) => count.dataset.tone !== undefined)

    expect(counts.map((count) => count.textContent)).toEqual(["10k+", "37", "10k+", "20k+"])
    expect(toned.map((count) => count.dataset.tone)).toEqual([SITUATION_TONES.openIncident])
    expect(iconColour(toned[0]!)).toBe(colourOf("openIncident"))
    expect(counts.filter((count) => count.querySelector("svg") !== null)).toEqual(toned)
    harness.unmount()
  })
})
