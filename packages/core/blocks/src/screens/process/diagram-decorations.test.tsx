// @vitest-environment happy-dom
import { cleanup, fireEvent, render, renderHook, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type { CallLinkData, ElementBadgeData, InstanceScopeCode } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { CountBadgeProps, ScreenOpenHow } from "../slots.js"
import { BadgeCluster } from "./badge-cluster.js"
import { BadgeLegend } from "./badge-legend.js"
import { CallButton, useCallLabel } from "./call-button.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

function Badge({ kind, count, stale, legend }: CountBadgeProps) {
  return (
    <span data-badge={kind} data-stale={stale} data-legend={legend}>
      {count}
    </span>
  )
}

function inLocale(node: ReactNode, locale = "en") {
  return render(<LocaleProvider locale={locale}>{node}</LocaleProvider>).container
}

const [CALLING] = WORLD_SCREENS.callingProcess.badges

function clusterOf(locale = "en", badge: ElementBadgeData = CALLING!, stale = true) {
  const selected: [string, InstanceScopeCode, ScreenOpenHow][] = []
  const container = inLocale(
    <BadgeCluster
      badge={badge}
      elementName="Print shipping label"
      {...(stale ? { stale } : {})}
      onSelect={(...args) => selected.push(args)}
      Badge={Badge}
    />,
    locale,
  )
  return { container, selected }
}

describe("the counts on an element of a process's diagram", () => {
  it("show the incidents in called instances apart from the running ones, each a filter", () => {
    const { container, selected } = clusterOf()
    const group = within(container).getByRole("group", { name: "Print shipping label" })
    const counts = within(group).getAllByRole("button")

    expect(group.getAttribute("data-badge-for")).toBe("Activity_PrintShippingLabel")
    expect(
      counts.map((count) => [count.dataset.scope, count.getAttribute("aria-label"), count.title]),
    ).toEqual([
      [
        "withIncident",
        "Print shipping label: 1 incident in called instances. Show the instances with an incident here.",
        "Print shipping label: 1 incident in called instances. Show the instances with an incident here.",
      ],
      [
        "running",
        "Print shipping label: 1 instance running. Show the running instances here.",
        "Print shipping label: 1 instance running. Show the running instances here.",
      ],
    ])
    expect(
      [...group.querySelectorAll("[data-badge]")].map((badge) => [
        badge.getAttribute("data-badge"),
        badge.textContent,
        badge.getAttribute("data-stale"),
      ]),
    ).toEqual([
      ["incidentsInCalledInstances", "1", "true"],
      ["running", "1", "true"],
    ])
    fireEvent.click(counts[0]!, { ctrlKey: true })
    fireEvent.click(counts[1]!)
    expect(selected).toEqual([
      ["Activity_PrintShippingLabel", "withIncident", { toSide: true }],
      ["Activity_PrintShippingLabel", "running", { toSide: false }],
    ])
  })

  it("lead a count's name with the count it shows where its words write it out", () => {
    const { container } = clusterOf(
      "en",
      { ...CALLING!, running: 0, incidents: 1_500, incidentsInCalledInstances: 0 },
      false,
    )
    expect(container.querySelector("[data-badge]")?.getAttribute("data-stale")).toBe("false")

    expect(within(container).getByRole("button").getAttribute("aria-label")).toBe(
      "1.5k, Print shipping label: 1,500 incidents. Show the instances with an incident here.",
    )
  })

  it("speak German under a German locale", () => {
    const { container } = clusterOf("de")

    expect(
      within(container)
        .getAllByRole("button")
        .map((count) => count.title),
    ).toEqual([
      "Print shipping label: 1 Incident in aufgerufenen Instanzen. Zeig die Instanzen mit Incident an diesem Element.",
      "Print shipping label: 1 Instanz läuft. Zeig die laufenden Instanzen an diesem Element.",
    ])
    cleanup()
    const many = clusterOf("de", {
      ...CALLING!,
      running: 3,
      incidents: 2,
      incidentsInCalledInstances: 0,
    })
    expect(
      within(many.container)
        .getAllByRole("button")
        .map((count) => count.title),
    ).toEqual([
      "Print shipping label: 2 Incidents. Zeig die Instanzen mit Incident an diesem Element.",
      "Print shipping label: 3 Instanzen laufen. Zeig die laufenden Instanzen an diesem Element.",
    ])
  })
})

describe("the legend of a process's diagram", () => {
  it("says which version the badges count and what each says, after the surface's sample", () => {
    const container = inLocale(<BadgeLegend version={2} Badge={Badge} />)

    expect(within(container).getByRole("button", { name: "Legend" }).title).toBe("Legend")
    expect(container.querySelector("[popover]")?.textContent).toBe(
      "Badges count running instances of v2.waiting hereincident hereincident in a called instance",
    )
    expect(
      [...container.querySelectorAll("[data-badge]")].map((badge) => [
        badge.getAttribute("data-badge"),
        badge.getAttribute("data-legend"),
      ]),
    ).toEqual([
      ["running", "true"],
      ["incidents", "true"],
      ["incidentsInCalledInstances", "true"],
    ])
  })

  it("speaks German under a German locale", () => {
    const container = inLocale(<BadgeLegend version={2} Badge={Badge} />, "de")

    expect(container.querySelector("[popover]")?.textContent).toBe(
      "Die Badges zählen laufende Instanzen von v2.wartet hierIncident hierIncident in einer aufgerufenen Instanz",
    )
  })
})

describe("a call activity's button on a process's diagram", () => {
  it("opens what it calls, beside the view with Ctrl or Cmd, a missing process marked", () => {
    const opened: [string, ScreenOpenHow][] = []
    const container = inLocale(
      <>
        <CallButton
          elementId="Activity_A"
          label="Open called process Print label"
          onOpen={(...args) => opened.push(args)}
        />
        <CallButton
          elementId="Activity_B"
          label="pulse-label isn't deployed"
          missing
          onOpen={(...args) => opened.push(args)}
        />
      </>,
    )
    const [open, missing] = within(container).getAllByRole("button")

    expect([open?.getAttribute("aria-label"), open?.title, open?.dataset.state]).toEqual([
      "Open called process Print label",
      "Open called process Print label",
      undefined,
    ])
    expect([missing?.dataset.state, missing?.className]).toEqual([
      "missing",
      "bjs-drilldown call-button call-button--missing",
    ])
    fireEvent.click(open!)
    fireEvent.click(missing!, { metaKey: true })
    expect(opened).toEqual([
      ["Activity_A", { toSide: false }],
      ["Activity_B", { toSide: true }],
    ])
  })

  it("words each call link as the editors' core does, in English and German", () => {
    const calls: CallLinkData[] = [
      ...WORLD_SCREENS.callingProcess.calls,
      {
        elementId: "A",
        kind: "definition",
        definition: { id: "x:1", bpmnProcessId: "x", version: 1 },
      },
      { elementId: "B", kind: "missing", bpmnProcessId: "credit-scoring" },
      {
        elementId: "C",
        kind: "instances",
        instances: [
          {
            id: "3e9d1c2b-7a6f-4e5d-9c8b-1a2b3c4d5e6f",
            bpmnProcessId: "pulse-label",
            state: "running",
            withIncident: false,
          },
        ],
      },
      { elementId: "D", kind: "instances", instances: [] },
    ]
    const wrapper = (locale: string) =>
      function Wrapper({ children }: { readonly children: ReactNode }) {
        return <LocaleProvider locale={locale}>{children}</LocaleProvider>
      }
    const words = (locale: string) => {
      const label = renderHook(() => useCallLabel(), { wrapper: wrapper(locale) }).result.current
      return calls.map((call) => label(call, "local-operaton"))
    }

    expect(words("en")).toEqual([
      "Open called process Print label",
      "Open called process x",
      "credit-scoring isn't deployed on local-operaton, or you may not have permission to see it",
      "Open called instance pulse-label 3e9d1c2b…",
      "Choose one of 0 called instances",
    ])
    expect(words("de")).toEqual([
      "Aufgerufenen Prozess Print label öffnen",
      "Aufgerufenen Prozess x öffnen",
      "credit-scoring ist auf local-operaton nicht bereitgestellt, oder du darfst ihn nicht sehen",
      "Aufgerufene Instanz pulse-label 3e9d1c2b… öffnen",
      "Wähle eine von 0 aufgerufenen Instanzen",
    ])
  })
})
