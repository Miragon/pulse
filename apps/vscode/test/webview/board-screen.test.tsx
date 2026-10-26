import { afterEach, describe, expect, it } from "vitest"
import type { BoardView, PanelState } from "../../src/core/protocol/index.js"
import { BOARD_VIEW, BROKEN_BOARD_VIEW } from "../../dev/webview/fixtures/board.js"
import { buttonNamed, mountApp, waitForElement } from "./harness.js"
import type { Harness } from "./harness.js"

function ready(view: BoardView, refreshing = false): PanelState {
  return { status: "ready", view, refreshing }
}

function card(root: ParentNode, title: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(`section[aria-label="${title}"]`)
  if (found === null) {
    throw new Error(`No card ${title}.`)
  }
  return found
}

function texts(root: ParentNode, selector: string): string[] {
  return [...root.querySelectorAll(selector)].map((element) => element.textContent.trim())
}

describe("a board", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("names the board and its engines, and refreshes or opens the file on request", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    const bar = await waitForElement(harness.root, ".context-bar--board")

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
    const strips = await waitForElement(harness.root, ".strip-stack")

    expect(texts(strips, ".status-strip__title")).toEqual([
      "Can't reach prod-eu.",
      "billing-prod is not in .pulse-cli.json.",
    ])
    buttonNamed(strips, "Edit connection…").click()
    buttonNamed(strips, "Configure engines").click()
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
    const strips = await waitForElement(harness.root, ".strip-stack .status-strip")

    buttonNamed(strips, "Set credentials…").click()

    expect(harness.posted).toEqual([{ type: "setBoardCredentials", engine: "shop-test" }])
  })

  it("lists the engines that answered, the production one marked, and opens one on click", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    const engines = await waitForElement(harness.root, ".board-engines")

    expect(texts(engines, ".board-engine")).toEqual([
      "localLocal · Operaton 2.1.5 · 172 running · 13 with incident",
      "shop-testTest · CIB seven 2.2.0 · 9 running · 1 with incident",
    ])
    engines.querySelector<HTMLButtonElement>(".board-engine")?.click()
    expect(harness.posted).toEqual([{ type: "openBoardEngine", engine: "local", toSide: false }])
  })

  it("counts per engine, says the total is partial and warns above the threshold", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    await waitForElement(harness.root, ".board-card--counter")
    const counter = card(harness.root, "Waiting for payment")

    expect(counter.querySelector(".counter__value")?.textContent).toBe("12")
    expect(counter.querySelector(".counter__partial")?.textContent).toBe("from 2 of 3 engines")
    expect(counter.querySelector(".counter__threshold")?.textContent).toBe("above 5")
    expect(texts(counter, ".counter__engine")).toEqual(["local10", "shop-test2", "prod-eu—"])
    expect(counter.querySelector(".counter__entry--above")?.textContent).toBe("local10")

    const buttons = [...counter.querySelectorAll<HTMLButtonElement>(".counter__engine")]
    buttons[1]?.click()
    buttons[2]?.click()
    expect(buttons[2]?.disabled).toBe(true)
    expect(harness.posted).toEqual([
      {
        type: "openBoardProcess",
        engine: "shop-test",
        bpmnProcessId: "order-fulfillment",
        filter: { scope: "running", elementId: "Activity_AwaitPayment" },
        toSide: false,
      },
    ])
  })

  it("names the threshold without a warning while every engine stays below it", async () => {
    const calm = {
      ...BOARD_VIEW,
      rows: [[{ kind: "counter", title: "Calm", total: 3, known: 1, warnAbove: 5, entries: [] }]],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(calm))
    const counter = await waitForElement(harness.root, ".board-card--counter")

    expect(counter.querySelector(".counter__threshold")?.textContent).toBe("warns above 5")
    expect(counter.querySelector(".counter__partial")).toBeNull()
  })

  it("lists instances with incident per process and opens a process with its filter", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    await waitForElement(harness.root, ".board-card--incidentSummary")
    const summary = card(harness.root, "With incident per process")

    expect(summary.querySelector(".counter__value")?.textContent).toBe("14")
    expect(texts(summary, ".incident-summary__open")).toEqual([
      "Order fulfillmentlocal10",
      "Order fulfillmentshop-test1",
    ])
    summary.querySelector<HTMLButtonElement>(".incident-summary__open")?.click()
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

  it("says why an incident summary is empty", async () => {
    const empty = {
      ...BOARD_VIEW,
      rows: [
        [
          {
            kind: "incidentSummary",
            title: "None",
            groupBy: "engine",
            known: 0,
            engines: 1,
            rows: [],
          },
          {
            kind: "incidentSummary",
            title: "Calm",
            groupBy: "engine",
            total: 0,
            known: 1,
            engines: 1,
            rows: [],
          },
        ],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(empty))
    await waitForElement(harness.root, ".board-card--incidentSummary")

    expect(card(harness.root, "None").textContent).toContain("No engine answered.")
    expect(card(harness.root, "Calm").textContent).toContain("No instance has an open incident.")
  })

  it("lists the instances of every engine in one table and opens a row on its engine", async () => {
    harness = mountApp()
    harness.publish(ready(BOARD_VIEW))
    await waitForElement(harness.root, ".board-card--instanceList tbody tr")
    const list = card(harness.root, "Orders waiting for payment")

    expect(texts(list, "th")).toEqual(["Engine", "Business key", "Version", "Started", "Incident"])
    expect(texts(list, "tbody tr td:first-child")).toEqual(["local", "local", "shop-test"])
    expect(texts(list, ".board-groups__note")).toEqual([
      "local: showing 2 of 10",
      "shop-test: showing 1 of 2",
      "prod-eu: not read",
    ])
    expect(list.querySelector("tbody tr:last-child .incident-flag")).not.toBeNull()

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

  it("renders every column a board file may name", async () => {
    const row = {
      engine: "local",
      id: "81a2e0b4-3c1d-11ef-9a3e-0242ac120002",
      shortId: "81a2e0b4…",
      processName: "Order fulfillment",
      bpmnProcessId: "order-fulfillment",
      version: 3,
      state: "Completed",
      hasIncident: false,
      endedAt: "2026-10-26T08:00:00.000Z",
    } as const
    const everything = {
      ...BOARD_VIEW,
      rows: [
        [
          {
            kind: "instanceList",
            title: "Ended orders",
            columns: ["process", "state", "endedAt", "businessKey"],
            groups: [{ engine: "local", rows: [row] }],
          },
        ],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(everything))
    await waitForElement(harness.root, ".board-card--instanceList tbody tr")

    expect(texts(harness.root, "th")).toEqual(["Process", "State", "Ended", "Business key"])
    const cells = texts(harness.root, "tbody td")
    expect(cells[0]).toBe("Order fulfillment")
    expect(cells[1]).toBe("Completed")
    expect(cells[2]).not.toBe("")
    expect(cells[3]).toBe("81a2e0b4…")
    expect(texts(harness.root, ".board-groups__note")).toEqual(["local: showing 1 of ?"])
  })

  it("lists each problem of a broken file with its path and reason", async () => {
    harness = mountApp()
    harness.publish(ready(BROKEN_BOARD_VIEW))
    const strip = await waitForElement(harness.root, ".strip-stack .status-strip--danger")

    expect(strip.textContent).toContain("1 problem in shop-operations.board.json.")
    expect(strip.textContent).toContain("Pulse shows the last valid version until you fix them.")
    expect(texts(harness.root, ".board-problems__item")).toEqual([
      "rows[0].row[0].props.filter.activeElement needs a process: element ids are only unique within one process",
    ])
    buttonNamed(strip, "Open file").click()
    expect(harness.posted).toEqual([{ type: "openBoardFile" }])
  })

  it("says it shows nothing until a broken file is fixed when no version was valid", async () => {
    harness = mountApp()
    harness.publish(ready({ ...BROKEN_BOARD_VIEW, engines: [], rows: [] }))
    const strip = await waitForElement(harness.root, ".strip-stack .status-strip--danger")

    expect(strip.textContent).toContain("Pulse shows the board once you fix them.")
    expect(harness.root.querySelector(".context-bar__key")).toBeNull()
  })
})
