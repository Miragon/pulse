import { afterEach, describe, expect, it, vi } from "vitest"
import type { DefinitionView, PanelState, WebviewIntent } from "../../src/core/protocol/index.js"
import { DEFINITION_VIEW } from "../../dev/webview/fixtures/definition.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { TimeLabels } from "../../src/webview/format/time-labels.js"
import {
  allParts,
  buttonNamed,
  findPart,
  findRole,
  getRole,
  mountApp,
  queryPart,
  queryRole,
  radioNamed,
  waitForElement,
  type Harness,
} from "./harness.js"

function readyWith(change: Partial<DefinitionView>): PanelState {
  return { status: "ready", refreshing: false, view: { ...DEFINITION_VIEW, ...change } }
}

describe("instance list scopes", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("sends the pressed scope as it is", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    await findRole(harness.root, "radiogroup", { name: "Show instances" })

    for (const name of ["Running", "With incident", "Ended", "All"]) {
      radioNamed(harness.root, name).click()
    }

    expect(harness.posted.filter((intent) => intent.type === "filterInstances")).toEqual([
      { type: "filterInstances", filter: { scope: "running" } },
      { type: "filterInstances", filter: { scope: "withIncident" } },
      { type: "filterInstances", filter: { scope: "ended" } },
      { type: "filterInstances", filter: { scope: "all" } },
    ])
  })

  it("checks the scope of the shown list", async () => {
    harness = mountApp()
    harness.publish(FIXTURES["definition-ended"])
    await findRole(harness.root, "radiogroup", { name: "Show instances" })

    expect(radioNamed(harness.root, "Ended").getAttribute("aria-checked")).toBe("true")
    expect(radioNamed(harness.root, "Running").getAttribute("aria-checked")).toBe("false")
    expect(getRole(harness.root, "table", { name: "Instances" }).textContent).not.toContain(
      "Running",
    )
  })

  it("counts every scope in the one bar above the list, without a summary header", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    const bar = await findPart(harness.root, "filter-bar")

    expect(radioNamed(harness.root, "Running").textContent).toBe("Running 12")
    expect(radioNamed(harness.root, "Ended").textContent).toBe("Ended 12.4k")
    expect(radioNamed(harness.root, "Ended").querySelector("[title]")?.getAttribute("title")).toBe(
      "12,437",
    )
    expect(
      queryPart(radioNamed(harness.root, "With incident"), "segment-count", { tone: "danger" }),
    ).not.toBeNull()
    expect(bar.parentElement?.firstElementChild).toBe(bar)
    expect(queryRole(harness.root, "toolbar")).toBeNull()
    expect(queryRole(harness.root, "heading", { level: 2 })).toBeNull()
  })

  it("clears the search field when the host drops the business key", async () => {
    harness = mountApp()
    harness.publish(readyWith({ filter: { scope: "running", businessKey: "ORD-10442" } }))
    const field = await findRole<HTMLInputElement>(harness.root, "searchbox", {
      name: "Search by business key",
    })
    expect(field.value).toBe("ORD-10442")

    harness.publish(readyWith({ filter: { scope: "running" } }))

    await vi.waitFor(() => {
      expect(field.value).toBe("")
    })
  })

  it("keeps Load more disabled while the list refreshes", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.refreshing)

    const loadMore = await findRole<HTMLButtonElement>(
      await findPart(harness.root, "table-footer"),
      "button",
    )
    loadMore.click()

    expect(loadMore.disabled).toBe(true)
    expect(harness.posted.filter((intent) => intent.type === "loadMoreInstances")).toEqual([])
  })

  it("shows the lifecycle and the incident apart, so a suspended instance stays visible", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)
    const table = await findRole<HTMLTableElement>(harness.root, "table", { name: "Instances" })

    const row = [...(table.tBodies[0]?.rows ?? [])].find((candidate) =>
      candidate.textContent.includes("ORD-10440"),
    )

    expect(row && queryPart(row, "state-label", { tone: "neutral" })?.textContent).toBe("Suspended")
    expect(row && queryPart(row, "incident-flag", { tone: "danger" })?.textContent).toBe("Incident")
  })

  it("explains the badges for the version shown with shapes, not digits", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.definition)

    const toggle = await findRole<HTMLButtonElement>(
      await findPart(harness.root, "filter-bar"),
      "button",
      {
        name: "Legend",
      },
    )
    const legend = toggle.popoverTargetElement as HTMLElement

    expect(legend.textContent).toBe(
      "Badges count running instances of v7.waiting hereincident hereincident in a called instance",
    )
    expect(allParts(legend, "count-badge").map((badge) => badge.textContent)).toEqual(["", "", ""])
    expect(queryPart(harness.root, "diagram")?.textContent).not.toContain("waiting")
  })
})

describe("instance details", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  function postedOfType(type: WebviewIntent["type"]) {
    return harness.posted.filter((intent) => intent.type === type)
  }

  it("copies a handover from the header", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    await findPart(harness.root, "context-bar")

    buttonNamed(harness.root, "Copy handover").click()

    expect(postedOfType("copyHandover")).toEqual([{ type: "copyHandover" }])
  })

  it("shows the job of an incident with its type and a copyable id", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    const card = await findPart(harness.root, "incident-card")

    expect(card.textContent).toContain("5c1d77a0…")
    expect(card.textContent).toContain("a4b5c6d7…")
    expect(card.textContent).toContain("scoring-api")
    getRole(card, "button", { name: "Copy job ID" }).click()

    expect(postedOfType("copy")).toEqual([
      { type: "copy", text: "5c1d77a0-9e8f-4d7c-b6a5-4f3e2d1c0b9a", label: "job ID" },
    ])
  })

  it("expands a JSON value in place and copies it", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    await findPart(harness.root, "incident-card")
    buttonNamed(harness.root, "Variables6").click()

    const expand = await findRole<HTMLButtonElement>(harness.root, "button", {
      name: "Expand the value of customer",
    })
    expand.click()
    const full = await waitForElement(expand.parentElement!, "pre")
    getRole(harness.root, "button", { name: "Copy value of customer", includeHidden: true }).click()

    expect(full.textContent).toContain('"tier": "gold"')
    expect(expand.getAttribute("aria-expanded")).toBe("true")
    expect(postedOfType("copy")).toEqual([
      {
        type: "copy",
        text: '{"id":"C-77","tier":"gold","address":{"city":"Munich","zip":"80331"},"tags":["b2b","priority"]}',
        label: "value of customer",
      },
    ])
  })
})

describe("timestamps", () => {
  it("name the local zone and the UTC time in the tooltip", () => {
    const tooltip = TimeLabels.tooltip("2026-10-21T12:02:00Z")

    expect(tooltip).toMatch(/GMT|UTC|[A-Z]{3,4}/)
    expect(tooltip).toContain("12:02:00 UTC")
  })

  it("name seconds and milliseconds where precision counts, the day only when it is not today", () => {
    const at = new Date(2026, 9, 21, 9, 5, 7, 42)
    const iso = at.toISOString()

    expect(TimeLabels.precise(iso, at)).toBe("09:05:07.042")
    expect(TimeLabels.precise(iso, new Date(2026, 9, 22, 9))).toBe("Oct 21, 09:05:07.042")
    expect(TimeLabels.precise("not a time", at)).toBe("—")
    expect(TimeLabels.clock(iso, at)).toBe("09:05")
  })
})
