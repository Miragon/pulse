import { afterEach, describe, expect, it, vi } from "vitest"
import type { PanelState, WebviewIntent } from "../../src/core/protocol/index.js"
import { DEFINITION_VIEW, FILTERED_DEFINITION_VIEW } from "../../dev/webview/fixtures/definition.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { ScopeSegments } from "../../src/webview/components/scope-segments.js"
import {
  mount,
  mountApp,
  nextFrame,
  press,
  allParts,
  allRoles,
  findPart,
  findRole,
  getRole,
  queryPart,
  radioNamed,
  waitForElement,
  type Harness,
} from "./harness.js"

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
    expect(queryPart(harness.root, "segment-count", { tone: "danger" })).toBeNull()
  })

  it("marks a count that is only a lower bound", async () => {
    harness = mountApp()
    harness.publish({
      status: "ready",
      refreshing: false,
      view: {
        ...DEFINITION_VIEW,
        scopeCounts: {
          running: 10000,
          withIncident: 0,
          ended: 2,
          all: 10002,
          atLeast: ["running", "all"],
        },
      },
    })
    await waitForElement(harness.root, '[role="radiogroup"]')

    expect(radioNamed(harness.root, "Running").textContent).toBe("Running 10k+")
    expect(radioNamed(harness.root, "Running").querySelector("span")?.title).toBe("≥ 10,000")
    expect(radioNamed(harness.root, "Ended").textContent).toBe("Ended 2")
  })

  it("puts the element chip and the search on a second row when it is narrow", async () => {
    harness = mountApp({ width: 600 })
    harness.publish(FILTERED)
    const bar = await findPart(harness.root, "filter-bar")
    const chip = await findPart(bar, "filter-chip", { kind: "element" })
    const group = getRole(bar, "radiogroup", { name: "Show instances" })
    const search = getRole(bar, "searchbox").parentElement!
    const toggle = getRole(bar, "button", { name: "Legend" })

    expect(chip.getBoundingClientRect().top).toBeGreaterThan(group.getBoundingClientRect().bottom)
    expect(search.getBoundingClientRect().top).toBe(chip.getBoundingClientRect().top)
    expect(toggle.getBoundingClientRect().top).toBeLessThan(group.getBoundingClientRect().bottom)
    await vi.waitFor(() => {
      expect(chip.querySelector("[title]")?.getAttribute("title")).toBe("At Check credit")
    })
  })

  it("clears the element filter from the element's condition chip, which offers no edit", async () => {
    harness = mountApp({ width: 900 })
    harness.publish(FILTERED)
    const chip = await findPart(harness.root, "filter-chip", { kind: "element" })

    await vi.waitFor(() => {
      expect(chip.textContent).toBe("At Check credit")
    })
    expect(allRoles(chip, "button").map((button) => button.getAttribute("aria-label"))).toEqual([
      "Clear element filter",
    ])
    expect(allParts(harness.root, "filter-chip")).toEqual([chip])

    getRole(chip, "button", { name: "Clear element filter" }).click()

    expect(filtersPosted(harness)).toEqual([
      { type: "filterInstances", filter: { scope: "withIncident" } },
    ])
  })

  it("keeps the legend behind a button whose popover opens over the diagram", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    const toggle = await findRole<HTMLButtonElement>(harness.root, "button", { name: "Legend" })
    const popover = toggle.popoverTargetElement as HTMLElement
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
    const toggle = await findRole<HTMLButtonElement>(harness.root, "button", { name: "Legend" })
    toggle.click()

    press(toggle, "Escape")
    expect(filtersPosted(harness)).toEqual([])

    ;(toggle.popoverTargetElement as HTMLElement).hidePopover()
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
    const bar = await findPart(harness.root, "tab-bar")
    const toggle = getRole<HTMLButtonElement>(bar, "button", { name: "Legend" })
    const popover = toggle.popoverTargetElement as HTMLElement

    expect(bar.contains(popover)).toBe(true)
    expect(getRole(bar, "tablist")).not.toBeNull()
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
    const toggle = await findRole(await findPart(harness.root, "tab-bar"), "button", {
      name: "Legend",
    })

    expect(toggle.offsetParent).not.toBeNull()
    expect(allRoles(harness.root, "button", { name: "Legend" })).toEqual([toggle])
  })

  it("keeps a scope chosen right after the first render", async () => {
    const chosen: string[] = []
    const mounted = mount(
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
    )
    harness = { unmount: mounted.unmount } as Harness
    const { root } = mounted

    radioNamed(root, "Ended").click()
    await nextFrame()
    await nextFrame()

    expect(chosen).toEqual(["ended"])
    expect(radioNamed(root, "Ended").getAttribute("aria-checked")).toBe("true")
  })
})
