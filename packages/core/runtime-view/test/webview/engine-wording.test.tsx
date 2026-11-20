import {
  BpmnProcessId,
  DefinitionId,
  type DefinitionSummary,
  type ProcessRuntime,
} from "@miragon/pulse-engine-core"
import { PatchedRuntime } from "@miragon/pulse-engine-core/testing"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EnginePanel } from "../../src/core/panels/engine-panel.js"
import type { EngineView, PanelState, ProcessListFilter } from "../../src/core/protocol/index.js"
import { panelFixture } from "../core/support/panel-fixture.js"
import { allRoles, findRole, getRole, mountApp, press, queryPart, type Harness } from "./harness.js"

function summary(
  bpmnProcessId: string,
  counts: { readonly running: number; readonly withIncident: number },
  name?: string,
): DefinitionSummary {
  return {
    latest: {
      id: DefinitionId(`${bpmnProcessId}:7`),
      bpmnProcessId: BpmnProcessId(bpmnProcessId),
      version: 7,
      ...(name === undefined ? {} : { name }),
    },
    ...counts,
  }
}

const SHOP = [
  summary("order-fulfillment", { running: 15, withIncident: 9 }, "Order fulfillment"),
  summary("credit-scoring", { running: 40, withIncident: 7 }, "Credit scoring"),
  summary("return-handling", { running: 15, withIncident: 1 }, "Return handling"),
  summary("shipment", { running: 1_204, withIncident: 0 }),
]

function listing(definitions: readonly DefinitionSummary[]) {
  return (runtime: ProcessRuntime) =>
    new PatchedRuntime(runtime, { listDefinitions: () => Promise.resolve(definitions) })
}

async function stateOf(
  definitions: readonly DefinitionSummary[],
  filter?: ProcessListFilter,
): Promise<PanelState> {
  const fixture = panelFixture(listing(definitions))
  const panel = new EnginePanel(fixture.context)
  await panel.handle({ type: "ready" })
  if (filter !== undefined) {
    await panel.handle({ type: "filterProcesses", filter })
  }
  return fixture.lastState()
}

function textOf(element: Element | null): string | null {
  return element === null ? null : element.textContent
}

function describedBy(element: Element): string | null {
  const id = element.getAttribute("aria-describedby")
  return id === null ? null : textOf(document.getElementById(id))
}

function wordingOf(region: HTMLElement) {
  const group = getRole(region, "radiogroup")
  const search = getRole<HTMLInputElement>(region, "searchbox")
  const table = getRole(region, "table")
  return {
    region: region.getAttribute("aria-label"),
    scopes: [
      group.getAttribute("aria-label"),
      ...allRoles(group, "radio").map((radio) => radio.textContent),
    ],
    scopeTitles: [...group.querySelectorAll("[title]")].map((count) => count.getAttribute("title")),
    search: [search.getAttribute("aria-label"), search.placeholder],
    summary: textOf(queryPart(region, "filter-summary")),
    table: table.getAttribute("aria-label"),
    heads: [...table.querySelectorAll("th")].map((head) => head.textContent),
    rows: [...table.querySelectorAll("tbody tr")].map((row) => [
      row.getAttribute("aria-label"),
      describedBy(row),
      ...[...row.querySelectorAll("td")].map((cell) => cell.textContent),
    ]),
    empty: textOf(queryPart(region, "table-empty")),
  }
}

function engineViewOf(state: PanelState): EngineView {
  if (state.status !== "ready" || state.view.kind !== "engine") {
    throw new Error(`expected the engine tab's view, got ${state.status}`)
  }
  return state.view
}

function expectTheEnglishTheCoreSends(words: ReturnType<typeof wordingOf>, view: EngineView) {
  expect(words.summary).toBe(view.summary)
  expect(words.empty).toBe(words.rows.length === 0 ? view.emptyText : null)
}

async function shown(harness: Harness, state: PanelState) {
  harness.publish(state)
  const region = await findRole(harness.root, "region", { name: "Process list" })
  await vi.waitFor(() => {
    expect(getRole(region, "table")).toBeDefined()
  })
  const words = wordingOf(region)
  expectTheEnglishTheCoreSends(words, engineViewOf(state))
  return words
}

const SCOPES = {
  scopes: ["Show processes", "All 4", "With incident 3"],
  scopeTitles: ["4", "3"],
}

const BAR = {
  region: "Process list",
  search: ["Search by name or BPMN process ID", "Name or key"],
  summary: "4 processes · 1,274 running · 17 with incident · all versions",
  table: "Processes",
  heads: ["Process", "Latest version", "Running", "With incident"],
}

const HINT = "Enter opens the row, Ctrl or Cmd+C copies its ID."

const ROWS = {
  order: [
    "Process Order fulfillment",
    HINT,
    "Order fulfillment order-fulfillment",
    "v7",
    "15",
    "9Has open incidents",
  ],
  credit: [
    "Process Credit scoring",
    HINT,
    "Credit scoring credit-scoring",
    "v7",
    "40",
    "7Has open incidents",
  ],
  returns: [
    "Process Return handling",
    HINT,
    "Return handling return-handling",
    "v7",
    "15",
    "1Has open incidents",
  ],
  shipment: ["Process shipment", HINT, "shipment", "v7", "1,204", "0"],
}

describe("the engine tab's English words", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("name the scopes, the search, the summary, the columns and every row as before", async () => {
    harness = mountApp()

    expect(await shown(harness, await stateOf(SHOP))).toEqual({
      ...BAR,
      ...SCOPES,
      rows: [ROWS.order, ROWS.credit, ROWS.returns, ROWS.shipment],
      empty: null,
    })
  })

  it("keep them in the scope with incident and under a search", async () => {
    harness = mountApp()

    expect(await shown(harness, await stateOf(SHOP, { scope: "withIncident" }))).toEqual({
      ...BAR,
      ...SCOPES,
      rows: [ROWS.order, ROWS.credit, ROWS.returns],
      empty: null,
    })
    expect(
      await shown(harness, await stateOf(SHOP, { scope: "all", search: "ship" })),
    ).toMatchObject({
      scopes: ["Show processes", "All 1", "With incident 0"],
      summary: BAR.summary,
      rows: [ROWS.shipment],
    })
  })

  it("say that nothing matches a filter, and that nothing is deployed on an engine", async () => {
    harness = mountApp()

    expect(
      await shown(harness, await stateOf(SHOP, { scope: "all", search: "nothing" })),
    ).toMatchObject({
      scopes: ["Show processes", "All 0", "With incident 0"],
      rows: [],
      empty: "No processes match this filter.",
    })
    expect(await shown(harness, await stateOf([]))).toEqual({
      ...BAR,
      scopes: ["Show processes", "All 0", "With incident 0"],
      scopeTitles: ["0", "0"],
      summary: "0 processes · 0 running · 0 with incident · all versions",
      rows: [],
      empty: "No processes deployed on local, or you may not have permission to see them.",
    })
  })

  it("say that nothing is deployed on an engine under a search too, never that the search found none", async () => {
    harness = mountApp()

    expect(
      await shown(harness, await stateOf([], { scope: "withIncident", search: "order" })),
    ).toMatchObject({
      scopes: ["Show processes", "All 0", "With incident 0"],
      summary: "0 processes · 0 running · 0 with incident · all versions",
      rows: [],
      empty: "No processes deployed on local, or you may not have permission to see them.",
    })
  })

  it("name what a row's copy holds", async () => {
    harness = mountApp()
    await shown(harness, await stateOf(SHOP))
    const row = getRole(harness.root, "row", { name: "Process Credit scoring" })

    row.focus()
    press(row, "c", { ctrlKey: true })

    expect(harness.posted).toEqual([
      { type: "copy", text: "credit-scoring", label: "BPMN process ID" },
    ])
  })
})
