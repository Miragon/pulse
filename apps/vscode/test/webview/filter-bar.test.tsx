import { render } from "preact"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PanelState, WebviewIntent } from "../../src/core/protocol/index.js"
import { DEFINITION_VIEW, FILTERED_DEFINITION_VIEW } from "../../dev/webview/fixtures/definition.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { ScopeSegments } from "../../src/webview/components/scope-segments.js"
import { mountApp, nextFrame, press, radioNamed, waitForElement } from "./harness.js"
import type { Harness } from "./harness.js"

function filtersPosted(harness: Harness): WebviewIntent[] {
  return harness.posted.filter((intent) => intent.type === "filterInstances")
}

const FILTERED: PanelState = { status: "ready", refreshing: false, view: FILTERED_DEFINITION_VIEW }

describe("the filter bar of the definition panel", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("is one radio group with a single tab stop on the checked scope", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    const group = await waitForElement(harness.root, '[role="radiogroup"]')

    const radios = [...group.querySelectorAll('[role="radio"]')]

    expect(group.getAttribute("aria-label")).toBe("Show instances")
    expect(radios.map((radio) => radio.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"])
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
      "false",
    ])
  })

  it("moves and selects with the arrow keys, Home and End, and the latest request wins", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    await waitForElement(harness.root, '[role="radiogroup"]')
    radioNamed(harness.root, "Running").focus()
    const pressFocused = (key: string): void => {
      press(document.activeElement!, key)
    }

    pressFocused("ArrowRight")
    pressFocused("ArrowRight")
    await vi.waitFor(() => {
      expect(radioNamed(harness.root, "Ended").getAttribute("aria-checked")).toBe("true")
    })
    pressFocused("End")
    pressFocused("Home")
    pressFocused("ArrowLeft")

    expect(
      filtersPosted(harness).map((intent) => "filter" in intent && intent.filter.scope),
    ).toEqual(["withIncident", "ended", "all", "running", "all"])
    expect(document.activeElement).toBe(radioNamed(harness.root, "All"))
    await vi.waitFor(() => {
      expect(radioNamed(harness.root, "All").tabIndex).toBe(0)
    })
  })

  it("keeps the old counts while it refreshes and marks the group busy", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    const group = await waitForElement(harness.root, '[role="radiogroup"]')
    expect(group.getAttribute("aria-busy")).toBe("false")

    harness.publish(FIXTURES.refreshing)

    await vi.waitFor(() => {
      expect(group.getAttribute("aria-busy")).toBe("true")
    })
    expect(radioNamed(harness.root, "Running").textContent).toBe("Running 12")
  })

  it("shows a zero count and no alarm when no instance has an incident", async () => {
    harness = mountApp()
    harness.publish({
      status: "ready",
      refreshing: false,
      view: {
        ...DEFINITION_VIEW,
        scopeCounts: { running: 3, withIncident: 0, ended: 0, all: 3 },
      },
    })
    await waitForElement(harness.root, '[role="radiogroup"]')

    expect(radioNamed(harness.root, "With incident").textContent).toBe("With incident 0")
    expect(harness.root.querySelector(".segmented__count--danger")).toBeNull()
  })

  it("puts the element chip and the search on a second row when it is narrow", async () => {
    harness = mountApp({ width: 600 })
    harness.publish(FILTERED)
    const chip = await waitForElement(harness.root, ".filter-bar .filter-chip")
    const group = harness.root.querySelector('[role="radiogroup"]')!
    const search = harness.root.querySelector(".filter-bar .search-field")!
    const toggle = harness.root.querySelector(".filter-bar .legend__toggle")!

    expect(chip.getBoundingClientRect().top).toBeGreaterThan(group.getBoundingClientRect().bottom)
    expect(search.getBoundingClientRect().top).toBe(chip.getBoundingClientRect().top)
    expect(toggle.getBoundingClientRect().top).toBeLessThan(group.getBoundingClientRect().bottom)
    await vi.waitFor(() => {
      expect(chip.getAttribute("title")).toBe("At Check credit")
    })
  })

  it("keeps the legend behind a button whose popover opens over the diagram", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    const toggle = await waitForElement<HTMLButtonElement>(harness.root, ".legend__toggle")
    const popover = harness.root.querySelector<HTMLElement>(".legend__popover")!
    expect(toggle.offsetParent).not.toBeNull()
    expect(popover.matches(":popover-open")).toBe(false)

    toggle.click()

    expect(popover.matches(":popover-open")).toBe(true)
    expect(popover.textContent).toContain("Badges count running instances of v7.")
    expect(popover.textContent).toContain("incident in a called instance")
    expect(popover.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      toggle.getBoundingClientRect().top,
    )
  })

  it("closes the legend on Escape without clearing the element filter", async () => {
    harness = mountApp({ width: 900 })
    harness.publish(FILTERED)
    const toggle = await waitForElement<HTMLButtonElement>(harness.root, ".legend__toggle")
    toggle.click()

    press(toggle, "Escape")
    expect(filtersPosted(harness)).toEqual([])

    harness.root.querySelector<HTMLElement>(".legend__popover")?.hidePopover()
    press(toggle, "Escape")
    expect(filtersPosted(harness)).toEqual([
      { type: "filterInstances", filter: { scope: "withIncident" } },
    ])
  })
})

describe("the bar of the instance panel", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("holds the tabs and the marker legend behind a button, without the version line", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    const bar = await waitForElement(harness.root, ".tabs__bar")
    const toggle = bar.querySelector<HTMLButtonElement>(".legend__toggle")!
    const popover = bar.querySelector<HTMLElement>(".legend__popover")!

    expect(bar.querySelector('[role="tablist"]')).not.toBeNull()
    expect(popover.matches(":popover-open")).toBe(false)
    toggle.click()
    expect(popover.textContent).toBe(
      "waiting hereincident hereincident in a called instancealready done; green lines are the flows it took",
    )
    expect(harness.root.textContent).not.toContain("This instance on")
  })

  it("shows only the legend button at 650 pixels", async () => {
    harness = mountApp({ width: 650 })
    harness.publish(FIXTURES.instance)
    const toggle = await waitForElement<HTMLElement>(harness.root, ".tabs__bar .legend__toggle")

    expect(toggle.offsetParent).not.toBeNull()
    expect(harness.root.querySelector(".legend__inline")).toBeNull()
  })

  it("keeps a scope chosen right after the first render", async () => {
    const root = document.body.appendChild(document.createElement("div"))
    harness = {
      unmount: () => {
        render(null, root)
        root.remove()
      },
    } as Harness
    const chosen: string[] = []
    render(
      <ScopeSegments
        label="Show instances"
        options={[
          { scope: "running", label: "Running" },
          { scope: "ended", label: "Ended" },
        ]}
        checked="running"
        counts={{ running: 2, ended: 1 }}
        busy={false}
        onSelect={(scope) => chosen.push(scope)}
      />,
      root,
    )

    radioNamed(root, "Ended").click()
    await nextFrame()
    await nextFrame()

    expect(chosen).toEqual(["ended"])
    expect(radioNamed(root, "Ended").getAttribute("aria-checked")).toBe("true")
  })
})
