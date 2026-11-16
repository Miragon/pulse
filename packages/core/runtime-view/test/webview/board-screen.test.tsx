import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  BoardTarget,
  BoardView,
  CounterReadingData,
  CounterTile,
  IncidentSummaryRowData,
  IncidentSummaryTile,
  InstanceData,
  InstanceListTile,
  PanelState,
} from "../../src/core/protocol/index.js"
import {
  BOARD_VIEW,
  BROKEN_BOARD_VIEW,
  REFUSED_BOARD_VIEW,
} from "../../dev/webview/fixtures/board.js"
import { TimeLabels } from "../../src/webview/format/time-labels.js"
import {
  allParts,
  allRoles,
  buttonNamed,
  findPart,
  findRole,
  getRole,
  mountApp,
  part,
  press,
  queryPart,
  queryRole,
  waitForElement,
  type Harness,
} from "./harness.js"

function ready(view: BoardView, refreshing = false): PanelState {
  return { status: "ready", view, refreshing }
}

const ORDER = {
  id: "order-fulfillment:3",
  bpmnProcessId: "order-fulfillment",
  version: 3,
  name: "Order fulfillment",
} as const

function counterTile(
  title: string,
  tile: Pick<CounterTile, "readings" | "known" | "total">,
  { warnAbove, withIncident }: { readonly warnAbove: number; readonly withIncident?: true },
): CounterTile {
  const filter = {
    state: "running" as const,
    ...(withIncident === undefined ? {} : { withIncident }),
  }
  return {
    kind: "counter",
    widget: { widget: "counter", title, engines: ["local"], filter, warnAbove },
    targets: [],
    ...tile,
  }
}

const SHIPMENT = { id: "shipment:2", bpmnProcessId: "shipment", version: 2 } as const

function summaryTile(
  title: string,
  groupBy: IncidentSummaryTile["widget"]["groupBy"],
  rows: readonly IncidentSummaryRowData[],
  targets: readonly BoardTarget[],
): IncidentSummaryTile {
  return {
    kind: "incidentSummary",
    widget: { widget: "incidentSummary", title, engines: ["local", "shop-test"], groupBy },
    engines: 2,
    known: 2,
    total: rows.reduce((sum, row) => sum + (row.withIncident ?? 0), 0),
    rows,
    targets,
  }
}

function card(root: HTMLElement, title: string): HTMLElement {
  const found = getRole(root, "region", { name: title })
  expect(found.dataset.part).toBe("board-card")
  return found
}

function texts(root: ParentNode, selector: string): string[] {
  return [...root.querySelectorAll(selector)].map((element) => element.textContent.trim())
}

function partTexts(
  root: ParentNode,
  name: string,
  state?: Readonly<Record<string, string>>,
): string[] {
  return allParts(root, name, state).map((element) => element.textContent.trim())
}

function itemTexts(list: HTMLElement): string[] {
  return allRoles(list, "listitem").map((element) => element.textContent.trim())
}

describe("a board", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("names the board and its engines, and refreshes or opens the file on request", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    const bar = await findPart(harness.root, "context-bar", { kind: "board" })

    buttonNamed(bar, "Refresh").click()
    buttonNamed(bar, "Open file").click()

    expect(bar.querySelector("h1")?.textContent).toBe("Shop operations")
    expect(bar.textContent).toContain("4 engines: local, shop-test, prod-eu, billing-prod")
    expect(bar.textContent).toContain("As of")
    expect(harness.posted).toEqual([{ type: "refresh" }, { type: "openBoardFile" }])
  })

  it("says once per engine what went wrong, with the way out", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    const strips = await findPart(harness.root, "strips")

    expect(partTexts(strips, "strip-title")).toEqual([
      "Can't reach prod-eu.",
      "billing-prod is not in .pulse.json or your CLI config.",
    ])
    for (const button of allParts(strips, "status-strip").flatMap((strip) =>
      allRoles(strip, "button"),
    )) {
      button.click()
    }
    expect(harness.posted).toEqual([{ type: "editConnection" }, { type: "editConnection" }])
  })

  it("offers to set credentials for an engine that refused them", async () => {
    const refused = {
      ...BOARD_VIEW,
      engines: [
        {
          name: "shop-test",
          state: "failed",
          problem: {
            title: "shop-test rejected the credentials.",
            detail: "HTTP 401",
            canEditConnection: true,
            needsCredentials: true,
          },
        },
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(refused))
    const strips = await waitForElement(harness.root, `${part("strips")} ${part("status-strip")}`)

    buttonNamed(strips, "Set credentials…").click()

    expect(harness.posted).toEqual([{ type: "setBoardCredentials", engine: "shop-test" }])
  })

  it("lists the engines that answered, the production one marked, and opens one on click", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    const engines = await findRole(harness.root, "group", { name: "Engines of this board" })

    expect(allRoles(engines, "button").map((engine) => engine.textContent)).toEqual([
      "localLocal · Operaton 2.1.5 · 172 running · 13 with incident",
      "shop-testTest · CIB seven 2.2.0 · 9 running · 1 with incident",
    ])
    allRoles(engines, "button")[0]?.click()
    expect(harness.posted).toEqual([{ type: "openBoardEngine", engine: "local", toSide: false }])
  })

  it("counts per engine, says the total is partial and warns above the threshold", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    await findPart(harness.root, "board-card", { kind: "counter" })
    const counter = card(harness.root, "Waiting for payment")

    expect(queryPart(counter, "counter-value")?.textContent).toBe("12")
    expect(queryPart(counter, "counter-partial")?.textContent).toBe("from 2 of 3 engines")
    expect(queryPart(counter, "counter-threshold", { state: "above" })?.textContent).toBe(
      "local above 5",
    )
    expect(partTexts(counter, "counter-entry")).toEqual([
      "local10",
      "shop-test2",
      "prod-eunot read",
    ])
    expect(queryPart(counter, "counter-entry", { state: "above" })?.textContent).toBe("local10")

    const buttons = allRoles<HTMLButtonElement>(
      getRole(counter, "list", { name: "Per engine" }),
      "button",
    )
    expect(buttons.map((button) => button.textContent)).toEqual(["local10", "shop-test2"])
    expect(buttons[0]?.title).toBe(
      "Open the process on local, latest version first (Ctrl/Cmd+click: to the side)",
    )
    buttons[1]?.click()
    buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }))
    const filter = { scope: "running", elementId: "Activity_AwaitPayment" }
    expect(harness.posted).toEqual([
      {
        type: "openBoardProcess",
        engine: "shop-test",
        bpmnProcessId: "order-fulfillment",
        filter,
        toSide: false,
      },
      {
        type: "openBoardProcess",
        engine: "local",
        bpmnProcessId: "order-fulfillment",
        filter,
        toSide: true,
      },
    ])
  })

  it("names the threshold without a warning while every engine stays below it", async () => {
    const calm = {
      ...BOARD_VIEW,
      rows: [
        [counterTile("Calm", { readings: [], known: 1, total: { count: 3 } }, { warnAbove: 5 })],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(calm))
    const counter = await findPart(harness.root, "board-card", { kind: "counter" })

    expect(queryPart(counter, "counter-threshold")?.textContent).toBe("warns above 5")
    expect(queryPart(counter, "counter-partial")).toBeNull()
  })

  it("warns in the warning style when an engine stopped counting at or below the threshold", async () => {
    const tile = counterTile(
      "Running",
      {
        readings: [
          { engine: "capped", count: { count: 10000, atLeast: true }, undecided: true },
          { engine: "local", count: { count: 2 } },
        ],
        known: 2,
        total: { count: 10002, atLeast: true },
      },
      { warnAbove: 20000 },
    )
    harness = mountApp()
    harness.publish(ready({ ...BOARD_VIEW, rows: [[tile]] }))
    const counter = await findPart(harness.root, "board-card", { kind: "counter" })
    const threshold = queryPart(counter, "counter-threshold")

    expect(threshold?.textContent).toBe("capped stopped counting at 10,000 · warns above 20,000")
    expect(threshold?.dataset.state).toBe("undecided")
    expect(threshold?.querySelector("svg")).not.toBeNull()
    expect(queryPart(counter, "counter-value")?.textContent).toBe("≥ 10,002")
    expect(partTexts(counter, "counter-entry")).toEqual(["capped≥ 10,000", "local2"])
    expect(queryPart(counter, "counter-entry", { state: "above" })).toBeNull()
  })

  it("names the engines that stopped counting next to the engines above the threshold", async () => {
    const capped = {
      engine: "capped",
      count: { count: 10000, atLeast: true },
      undecided: true,
    } as const
    const search = { ...capped, engine: "search" } as const
    const local = { engine: "local", count: { count: 25000 }, above: true } as const
    const shop = { ...local, engine: "shop-test" } as const
    const running = (readings: readonly CounterReadingData[]): CounterTile =>
      counterTile(
        "Running",
        {
          readings,
          known: readings.length,
          total: {
            count: readings.reduce((sum, reading) => sum + (reading.count?.count ?? 0), 0),
            atLeast: true,
          },
        },
        { warnAbove: 20000 },
      )
    const tiles = [
      [capped, search],
      [capped, local],
      [capped, search, local],
      [capped, local, shop],
    ]
    harness = mountApp()
    harness.publish(ready({ ...BOARD_VIEW, rows: [tiles.map(running)] }))
    await findPart(harness.root, "board-card", { kind: "counter" })

    const lines = [
      "local above 20,000 · capped stopped counting at 10,000 · warns above 20,000",
      "local above 20,000 · 2 engines stopped counting · warns above 20,000",
      "2 engines above 20,000 · capped stopped counting at 10,000 · warns above 20,000",
    ]
    expect(partTexts(harness.root, "counter-threshold")).toEqual([
      "2 engines stopped counting · warns above 20,000",
      ...lines,
    ])
    expect(partTexts(harness.root, "counter-threshold", { state: "above" })).toEqual(lines)
    expect(partTexts(harness.root, "counter-threshold", { state: "undecided" })).toEqual([
      "2 engines stopped counting · warns above 20,000",
    ])
  })

  it("lists instances with incident per process and opens a process with its filter", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    await findPart(harness.root, "board-card", { kind: "incidentSummary" })
    const summary = card(harness.root, "With incident per process")

    expect(queryPart(summary, "counter-value")?.textContent).toBe("14")
    expect(itemTexts(getRole(summary, "list", { name: "Per process" }))).toEqual([
      "Order fulfillmentlocal10with incident",
      "Order fulfillmentshop-test1with incident",
    ])
    allRoles(summary, "button")[0]?.click()
    expect(harness.posted).toEqual([
      {
        type: "openBoardProcess",
        engine: "local",
        bpmnProcessId: "order-fulfillment",
        filter: { scope: "withIncident" },
        toSide: false,
      },
    ])
  })

  it("opens the process of the summary row clicked when processes share an engine", async () => {
    const withIncident = { scope: "withIncident" } as const
    const shared = {
      ...BOARD_VIEW,
      rows: [
        [
          summaryTile(
            "Shared engine",
            "process",
            [
              { engine: "local", process: ORDER, withIncident: 5 },
              { engine: "local", process: SHIPMENT, withIncident: 2 },
            ],
            [
              { engine: "local", bpmnProcessId: "order-fulfillment", filter: withIncident },
              { engine: "local", bpmnProcessId: "shipment", filter: withIncident },
            ],
          ),
        ],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(shared))
    await findPart(harness.root, "board-card", { kind: "incidentSummary" })
    const list = getRole(card(harness.root, "Shared engine"), "list", { name: "Per process" })

    allRoles(list, "button")[1]?.click()

    expect(harness.posted).toEqual([
      {
        type: "openBoardProcess",
        engine: "local",
        bpmnProcessId: "shipment",
        filter: withIncident,
        toSide: false,
      },
    ])
  })

  it("names each engine of a summary per engine and opens the engine of the row clicked", async () => {
    const perEngine = {
      ...BOARD_VIEW,
      rows: [
        [
          summaryTile(
            "Incidents per engine",
            "engine",
            [
              { engine: "local", withIncident: 7 },
              { engine: "shop-test", withIncident: 1 },
            ],
            ["local", "shop-test"].map((engine) => ({ engine, filter: { scope: "withIncident" } })),
          ),
        ],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(perEngine))
    await findPart(harness.root, "board-card", { kind: "incidentSummary" })
    const list = getRole(card(harness.root, "Incidents per engine"), "list", { name: "Per engine" })

    expect(itemTexts(list)).toEqual(["local7with incident", "shop-test1with incident"])
    allRoles(list, "button")[1]?.click()
    expect(harness.posted).toEqual([
      { type: "openBoardEngine", engine: "shop-test", toSide: false },
    ])
  })

  it("names a process without a name by its BPMN id in a list, an incident list and a summary", async () => {
    const local = ["local"]
    const unnamed = {
      ...BOARD_VIEW,
      rows: [
        [
          {
            kind: "instanceList",
            widget: {
              widget: "instanceList",
              title: "Shipments",
              engines: local,
              filter: { state: "running" },
              columns: ["process"],
            },
            groups: [
              {
                engine: "local",
                instances: [
                  { id: "s-1", definition: SHIPMENT, state: "running", hasIncident: true },
                ],
              },
            ],
          },
          {
            kind: "incidentList",
            widget: { widget: "incidentList", title: "Shipment incidents", engines: local },
            groups: [
              {
                engine: "local",
                incidents: [
                  {
                    id: "i-1",
                    instanceId: "s-1",
                    definition: SHIPMENT,
                    elementId: "Task_Ship",
                    type: "failedJob",
                    message: "Carrier API answered 503",
                    createdAt: "2026-10-26T08:00:00.000Z",
                  },
                ],
              },
            ],
          },
          summaryTile(
            "Shipments with incident",
            "process",
            [
              { engine: "local", process: ORDER, withIncident: 5 },
              { engine: "local", process: SHIPMENT, withIncident: 1 },
            ],
            [],
          ),
        ],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(unnamed))
    await waitForElement(harness.root, `${part("board-card", { kind: "incidentList" })} tbody tr`)

    expect(texts(card(harness.root, "Shipments"), "tbody td")).toEqual(["shipment"])
    expect(texts(card(harness.root, "Shipment incidents"), "tbody tr td:first-child")).toEqual([
      "shipment",
    ])
    expect(
      itemTexts(
        getRole(card(harness.root, "Shipments with incident"), "list", { name: "Per process" }),
      ),
    ).toEqual(["Order fulfillmentlocal5with incident", "shipmentlocal1with incident"])
  })

  it("says why an incident summary is empty", async () => {
    const empty = {
      ...BOARD_VIEW,
      rows: [
        [
          {
            kind: "incidentSummary",
            widget: {
              widget: "incidentSummary",
              title: "None",
              engines: ["local"],
              groupBy: "engine",
            },
            engines: 1,
            known: 0,
            rows: [],
            targets: [],
          },
          {
            kind: "incidentSummary",
            widget: {
              widget: "incidentSummary",
              title: "Calm",
              engines: ["local"],
              groupBy: "engine",
            },
            engines: 1,
            known: 1,
            total: 0,
            rows: [],
            targets: [],
          },
        ],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(empty))
    await findPart(harness.root, "board-card", { kind: "incidentSummary" })

    expect(card(harness.root, "None").textContent).toContain("No engine was read.")
    expect(card(harness.root, "Calm").textContent).toContain("No instance has an open incident.")
  })

  it("lists the instances of every engine in one table and opens a row on its engine", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    await waitForElement(harness.root, `${part("board-card", { kind: "instanceList" })} tbody tr`)
    const list = card(harness.root, "Orders waiting for payment")

    expect(texts(list, "th")).toEqual(["Engine", "Business key", "Version", "Started", "Incident"])
    expect(texts(list, "tbody tr td:first-child")).toEqual(["local", "local", "shop-test"])
    expect(partTexts(list, "group-note")).toEqual([
      "local: showing 2 of 10",
      "shop-test: showing 1 of 2",
      "prod-eu: not read",
    ])
    expect(list.querySelector(`tbody tr:last-child ${part("incident-flag")}`)).not.toBeNull()

    list.querySelector<HTMLTableRowElement>("tbody tr:last-child")?.click()
    expect(harness.posted).toEqual([
      {
        type: "openBoardInstance",
        engine: "shop-test",
        instanceId: "9b1c4d22-3c1d-11ef-9a3e-0242ac120002",
        toSide: false,
      },
    ])
  })

  it("opens an instance row to the side with Ctrl or Cmd, and copies its ID with Ctrl+C", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    await waitForElement(harness.root, `${part("board-card", { kind: "instanceList" })} tbody tr`)
    const list = card(harness.root, "Orders waiting for payment")
    const row = list.querySelector<HTMLTableRowElement>("tbody tr:last-child")
    const instance = {
      type: "openBoardInstance",
      engine: "shop-test",
      instanceId: "9b1c4d22-3c1d-11ef-9a3e-0242ac120002",
      toSide: true,
    }

    row?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))
    row?.focus()
    press(document.activeElement!, "Enter", { metaKey: true })
    press(document.activeElement!, "c", { ctrlKey: true })

    expect(document.activeElement).toBe(row)
    expect(harness.posted).toEqual([
      instance,
      instance,
      { type: "copy", text: "9b1c4d22-3c1d-11ef-9a3e-0242ac120002", label: "Instance ID" },
    ])
  })

  it("renders every column a board file may name", async () => {
    const row = {
      id: "81a2e0b4-3c1d-11ef-9a3e-0242ac120002",
      definition: ORDER,
      state: "completed",
      hasIncident: false,
      endedAt: "2026-10-26T08:00:00.000Z",
    } as const
    const everything = {
      ...BOARD_VIEW,
      rows: [
        [
          {
            kind: "instanceList",
            widget: {
              widget: "instanceList",
              title: "Ended orders",
              engines: ["local"],
              filter: { state: "ended" },
              columns: ["process", "state", "endedAt", "businessKey"],
            },
            groups: [{ engine: "local", instances: [row] }],
          },
        ],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(everything))
    await waitForElement(harness.root, `${part("board-card", { kind: "instanceList" })} tbody tr`)

    expect(texts(harness.root, "th")).toEqual(["Process", "State", "Ended", "Business key"])
    const cells = texts(harness.root, "tbody td")
    expect(cells[0]).toBe("Order fulfillment")
    expect(cells[1]).toBe("Completed")
    expect(cells[2]).toBe(TimeLabels.clock(row.endedAt))
    expect(cells[3]).toBe("81a2e0b4…")
    expect(partTexts(harness.root, "group-note")).toEqual(["local: showing 1 of ?"])
  })

  it("says of a list's total that an engine stopped counting there", async () => {
    const row: InstanceData = {
      id: "81a2e0b4-3c1d-11ef-9a3e-0242ac120002",
      definition: ORDER,
      state: "running",
      hasIncident: false,
    }
    const capped = {
      ...BOARD_VIEW,
      rows: [
        [
          {
            kind: "instanceList",
            widget: {
              widget: "instanceList",
              title: "Running orders",
              engines: ["capped", "local"],
              filter: { state: "running" },
              columns: ["engine", "process"],
            },
            groups: [
              { engine: "capped", total: { count: 10000, atLeast: true }, instances: [row] },
              { engine: "local", total: { count: 1 }, instances: [row] },
            ],
          },
        ],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(capped))
    await waitForElement(harness.root, `${part("board-card", { kind: "instanceList" })} tbody tr`)

    expect(partTexts(harness.root, "group-note")).toEqual([
      "capped: showing 1 of ≥ 10,000",
      "local: showing 1 of 1",
    ])
  })

  it("lists each problem of a broken file with its path and reason", async () => {
    harness = mountApp()
    harness.publish(ready(BROKEN_BOARD_VIEW))
    const strip = await waitForElement(
      harness.root,
      `${part("strips")} ${part("status-strip", { tone: "danger" })}`,
    )

    expect(strip.textContent).toContain("1 problem in shop-operations.board.json.")
    expect(strip.textContent).toContain("Pulse shows the last valid version until you fix them.")
    expect(itemTexts(getRole(harness.root, "region", { name: /^Problems in / }))).toEqual([
      "title must be a text that is not empty",
    ])
    buttonNamed(strip, "Open file").click()
    expect(harness.posted).toEqual([{ type: "openBoardFile" }])
  })

  it("says of a file it could not read that it could not be read", async () => {
    harness = mountApp()
    harness.publish(ready({ ...BOARD_VIEW, problems: [{ path: "(file)", code: "unreadable" }] }))
    const problems = await findRole(harness.root, "region", { name: /^Problems in / })

    expect(itemTexts(problems)).toEqual(["(file) could not be read"])
  })

  it("shows a broken widget's problems in its place and reads the widgets beside it", async () => {
    harness = mountApp()
    harness.publish(ready(REFUSED_BOARD_VIEW))
    await findPart(harness.root, "board-card", { kind: "refused" })
    const refused = card(harness.root, "Ended orders with incident")

    expect(refused.dataset.kind).toBe("refused")
    expect(queryPart(refused, "refused-reason")?.textContent).toBe(
      "Pulse reads nothing for this widget until you fix it.",
    )
    expect(itemTexts(getRole(refused, "list", { name: "Problems of this widget" }))).toEqual([
      'rows[0].row[1].props.filter.withIncident only matches running instances, since an ended instance has no open incident; remove it or use state "running"',
    ])
    expect(card(harness.root, 'Widget "chart"').dataset.kind).toBe("refused")
    expect(queryPart(card(harness.root, "Waiting for payment"), "counter-value")?.textContent).toBe(
      "12",
    )
    expect(partTexts(harness.root, "strip-title")).toEqual([
      "1 note in shop-operations.board.json.",
      "Can't reach prod-eu.",
      "billing-prod is not in .pulse.json or your CLI config.",
    ])
    expect(queryRole(harness.root, "region", { name: /^Problems in / })).toBeNull()

    buttonNamed(refused, "Open file").click()
    expect(harness.posted).toEqual([{ type: "openBoardFile" }])
  })

  it("names a note of the file in a quiet strip, the list behind Details", async () => {
    harness = mountApp()
    harness.publish(ready(REFUSED_BOARD_VIEW))
    const notes = await findPart(harness.root, "board-notes")
    expect(queryPart(notes, "status-strip")?.dataset.tone).toBe("info")
    expect(queryPart(notes, "strip-title")?.textContent).toBe(
      "1 note in shop-operations.board.json.",
    )
    const details = buttonNamed(notes, "Details")
    details.click()
    await vi.waitFor(() => {
      expect(details.getAttribute("aria-expanded")).toBe("true")
    })
    expect(document.getElementById(details.getAttribute("aria-controls") ?? "")?.textContent).toBe(
      "layout is not a key this version of Pulse knows; Pulse shows the board without it",
    )
    buttonNamed(notes, "Open file").click()
    expect(harness.posted).toEqual([{ type: "openBoardFile" }])
  })

  it("shows no note strip for a file without notes", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    await findPart(harness.root, "board-card", { kind: "counter" })

    expect(queryPart(harness.root, "board-notes")).toBeNull()
  })

  it("says it shows nothing until a broken file is fixed when no version was valid", async () => {
    harness = mountApp()
    harness.publish(ready({ ...BROKEN_BOARD_VIEW, engines: [], rows: [] }))
    const strip = await waitForElement(
      harness.root,
      `${part("strips")} ${part("status-strip", { tone: "danger" })}`,
    )

    expect(strip.textContent).toContain("Pulse shows the board once you fix them.")
    expect(queryPart(harness.root, "context-key")).toBeNull()
  })

  it("names several engines above the threshold and marks a count of incidents in words", async () => {
    const tile = counterTile(
      "Orders with incident",
      {
        readings: [
          { engine: "local", count: { count: 4 }, above: true },
          { engine: "shop-test", count: { count: 3 }, above: true },
        ],
        known: 2,
        total: { count: 7 },
      },
      { warnAbove: 1, withIncident: true },
    )
    harness = mountApp()
    harness.publish(ready({ ...BOARD_VIEW, rows: [[tile]] }))
    const counter = await findPart(harness.root, "board-card", { kind: "counter" })

    expect(queryPart(counter, "counter-threshold", { state: "above" })?.textContent).toBe(
      "2 engines above 1",
    )
    expect(queryPart(counter, "counter-value", { tone: "danger" })?.textContent).toBe("7")
    expect(partTexts(counter, "counter-count", { tone: "danger" })).toEqual(["4", "3"])
    const value = queryPart(counter, "counter-value", { tone: "danger" })!
    const figure = value.closest('[data-slot="count-figure"]')
    expect(figure?.textContent).toBe("7with incident")
    expect(figure?.querySelector("svg")).not.toBeNull()
    expect(getComputedStyle(value).color).toBe(getComputedStyle(counter).color)
    expect(value.closest("button")).toBeNull()
  })

  it("names a widget without a title by its filter, its process or its kind", async () => {
    const local = ["local"]
    const untitled = {
      ...BOARD_VIEW,
      rows: [
        [
          {
            kind: "counter",
            widget: {
              widget: "counter",
              engines: local,
              filter: {
                state: "running",
                process: "order",
                activeElement: "Task_Pay",
                withIncident: true,
                businessKey: "B-1",
              },
            },
            readings: [],
            known: 0,
            targets: [],
          },
          {
            kind: "instanceList",
            widget: {
              widget: "instanceList",
              engines: local,
              filter: { state: "ended", withIncident: false },
              columns: ["state"],
            },
            groups: [],
          },
          {
            kind: "incidentSummary",
            widget: { widget: "incidentSummary", engines: local, groupBy: "engine" },
            engines: 1,
            known: 0,
            rows: [],
            targets: [],
          },
        ],
        [
          {
            kind: "processDiagram",
            widget: { widget: "processDiagram", engines: local, process: "order" },
            engine: "local",
            latest: ORDER,
          },
          {
            kind: "processDiagram",
            widget: { widget: "processDiagram", engines: local, process: "invoice" },
            engine: "local",
            notDeployed: true,
          },
          {
            kind: "incidentList",
            widget: { widget: "incidentList", engines: local, process: "order" },
            groups: [],
          },
          { kind: "incidentList", widget: { widget: "incidentList", engines: local }, groups: [] },
          { kind: "refused", widget: "chart", problems: [] },
          { kind: "refused", problems: [] },
        ],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(untitled))
    await findPart(harness.root, "board-card", { kind: "refused" })

    expect(
      allParts(harness.root, "board-card").map(
        (board) => getRole(board, "heading", { level: 2 }).textContent,
      ),
    ).toEqual([
      "Running instances with incident of order at Task_Pay with key B-1",
      "Ended instances without incident",
      "Instances with incident",
      "Order fulfillment",
      "invoice",
      "Open incidents of order",
      "Open incidents",
      'Widget "chart"',
      "Widget",
    ])
  })

  it("adds the engine column to a list over several engines unless the file names it", async () => {
    const list = (engines: readonly string[], columns: InstanceListTile["widget"]["columns"]) =>
      ({
        kind: "instanceList",
        widget: {
          widget: "instanceList",
          title: `${engines.join(", ")}: ${columns.join(", ")}`,
          engines,
          filter: { state: "running" },
          columns,
        },
        groups: engines.map((engine) => ({ engine, instances: [] })),
      }) satisfies InstanceListTile
    const lists = [
      list(["local", "shop-test"], ["process"]),
      list(["local", "shop-test"], ["process", "engine"]),
      list(["local"], ["process"]),
    ]
    harness = mountApp()
    harness.publish(ready({ ...BOARD_VIEW, rows: [lists] }))
    await findPart(harness.root, "board-card", { kind: "instanceList" })

    expect(lists.map((tile) => texts(card(harness.root, tile.widget.title), "th"))).toEqual([
      ["Engine", "Process"],
      ["Process", "Engine"],
      ["Process"],
    ])
  })

  it("keeps the board on screen while it reads again", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW, true))
    const bar = await findPart(harness.root, "context-bar", { kind: "board" })

    expect(bar.textContent).toContain("Refreshing")
    expect(queryPart(harness.root, "board-card", { kind: "counter" })).not.toBeNull()
  })
})
