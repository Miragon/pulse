import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  type Incident,
} from "@miragon/pulse-engine-core"
import { afterEach, describe, expect, it, vi } from "vitest"
import orderXml from "../../dev/webview/fixtures/order-fulfillment.bpmn"
import { BoardPanel } from "../../src/core/boards/board-panel.js"
import type { WebviewIntent } from "../../src/core/protocol/index.js"
import { boardFixture, instance, stubbed, summary } from "../core/support/board-fixture.js"
import {
  allRoles,
  buttonNamed,
  getRole,
  mountApp,
  waitForElement,
  type Harness,
} from "./harness.js"

const PROCESS = "order-fulfillment"

const SHIP_INCIDENT: Incident = {
  id: IncidentId("x-1"),
  instanceId: InstanceId("i-7"),
  definition: {
    id: DefinitionId(`${PROCESS}:1`),
    bpmnProcessId: BpmnProcessId(PROCESS),
    version: 1,
    name: "Order fulfillment",
  },
  elementId: ElementId("Activity_ShipOrder"),
  type: "failedJob",
  message: "Carrier API answered 503",
  createdAt: "2026-10-26T08:30:00.000Z" as Incident["createdAt"],
}

const SHOP = stubbed({
  describeEngine: () => Promise.resolve({ product: "Engine", version: "7.24" }),
  listDefinitions: () => Promise.resolve([summary(PROCESS, 10, 3, "Order fulfillment")]),
  countInstances: (filter) => Promise.resolve({ count: filter.withIncident === true ? 3 : 10 }),
  searchInstances: () => Promise.resolve({ items: [instance("i-1", PROCESS, "ORD-1")] }),
  searchIncidents: () => Promise.resolve({ items: [SHIP_INCIDENT] }),
  getDiagramXml: () => Promise.resolve(orderXml),
  getElementStatistics: () =>
    Promise.resolve([
      {
        elementId: ElementId("Activity_CheckCredit"),
        active: 4,
        incidents: 0,
        incidentsInCalledInstances: 0,
      },
      {
        elementId: ElementId("Activity_ShipOrder"),
        active: 6,
        incidents: 3,
        incidentsInCalledInstances: 0,
      },
    ]),
})

const WIDGETS = [
  {
    widget: "counter",
    props: {
      title: "Waiting to ship",
      filter: { process: PROCESS, activeElement: "Activity_ShipOrder", businessKey: "ORD-1" },
    },
  },
  {
    widget: "counter",
    props: { title: "Orders with incident", filter: { process: PROCESS, withIncident: true } },
  },
  { widget: "counter", props: { title: "Everything running", filter: { state: "running" } } },
  { widget: "incidentSummary", props: { title: "Per process", groupBy: "process" } },
  { widget: "incidentSummary", props: { title: "Incidents by engine", groupBy: "engine" } },
  { widget: "processDiagram", props: { title: "Flow", process: PROCESS } },
  { widget: "instanceList", props: { title: "Orders", filter: { process: PROCESS } } },
  { widget: "incidentList", props: { title: "Open incidents", process: PROCESS } },
]

async function builtBoard() {
  const content = { title: "Shop", engines: ["shop"], rows: WIDGETS.map((row) => ({ row: [row] })) }
  const fixture = boardFixture(content, [{ name: "shop", runtime: SHOP }])
  const panel = new BoardPanel(fixture.context)
  await panel.handle({ type: "ready" })
  return { fixture, panel }
}

function card(root: HTMLElement, title: string): Promise<HTMLElement> {
  return vi.waitFor(
    () => {
      const found = allRoles(root, "region", { name: title }).find(
        (region) => region.dataset.part === "board-card",
      )
      if (found === undefined) {
        throw new Error(`No board card named ${title} yet.`)
      }
      return found
    },
    { timeout: 5000, interval: 25 },
  )
}

async function clickFirstButton(root: HTMLElement, title: string, list: string): Promise<void> {
  const tile = await card(root, title)
  allRoles(getRole(tile, "list", { name: list }), "button")[0]?.click()
}

async function clickFirstRow(root: HTMLElement, title: string): Promise<void> {
  const tile = await card(root, title)
  const row = await waitForElement<HTMLTableRowElement>(tile, "tbody tr")
  row.click()
}

async function clickDiagram(root: HTMLElement): Promise<void> {
  const tile = await card(root, "Flow")
  const badges = await waitForElement<HTMLElement>(tile, '[data-badge-for="Activity_ShipOrder"]')
  badges.querySelector<HTMLButtonElement>('[data-scope="withIncident"]')?.click()
  tile
    .querySelector('g.djs-element[data-element-id="Activity_CheckCredit"] .djs-hit')
    ?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
  buttonNamed(tile, "Open process").click()
}

function typesOf(intents: readonly WebviewIntent[]): string[] {
  return intents.map((intent) => intent.type)
}

describe("the clicks on a board the core built", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("open what the core offers, each through its navigation", async () => {
    const { fixture, panel } = await builtBoard()
    harness = mountApp()
    harness.publish({ status: "ready", view: fixture.view(), refreshing: false })

    await clickFirstButton(harness.root, "Waiting to ship", "Per engine")
    await clickFirstButton(harness.root, "Orders with incident", "Per engine")
    await clickFirstButton(harness.root, "Everything running", "Per engine")
    await clickFirstButton(harness.root, "Per process", "Per process")
    await clickFirstButton(harness.root, "Incidents by engine", "Per engine")
    await clickDiagram(harness.root)
    await clickFirstRow(harness.root, "Orders")
    await clickFirstRow(harness.root, "Open incidents")
    for (const intent of harness.posted) {
      await panel.handle(intent)
    }

    const navigation = fixture.navigation
    const process = BpmnProcessId(PROCESS)
    const here = { toSide: false }
    expect(typesOf(harness.posted)).toEqual([
      ...Array.from({ length: 2 }, () => "openBoardProcess"),
      "openBoardEngine",
      "openBoardProcess",
      "openBoardEngine",
      ...Array.from({ length: 3 }, () => "openBoardProcess"),
      ...Array.from({ length: 2 }, () => "openBoardInstance"),
    ])
    expect(navigation.openDefinition.mock.calls).toEqual([
      [
        "shop",
        process,
        { scope: "running", elementId: "Activity_ShipOrder", businessKey: "ORD-1" },
        here,
      ],
      ["shop", process, { scope: "withIncident" }, here],
      ["shop", process, { scope: "withIncident" }, here],
      ["shop", process, { scope: "withIncident", elementId: "Activity_ShipOrder" }, here],
      ["shop", process, { scope: "running", elementId: "Activity_CheckCredit" }, here],
      ["shop", process, { scope: "running" }, here],
    ])
    expect(navigation.openEngine.mock.calls).toEqual([
      ["shop", here],
      ["shop", here],
    ])
    expect(navigation.openInstance.mock.calls).toEqual([
      ["shop", InstanceId("i-1"), here],
      ["shop", InstanceId("i-7"), here],
    ])
  })
})
