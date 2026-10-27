import { afterEach, describe, expect, it } from "vitest"
import type { BoardView, PanelState } from "../../src/core/protocol/index.js"
import { PROCESS_BOARD_VIEW } from "../../dev/webview/fixtures/process-board.js"
import { buttonNamed, mountApp, waitForElement } from "./harness.js"
import type { Harness } from "./harness.js"

function ready(view: BoardView): PanelState {
  return { status: "ready", view, refreshing: false }
}

function texts(root: ParentNode, selector: string): string[] {
  return [...root.querySelectorAll(selector)].map((element) => element.textContent.trim())
}

describe("the process widgets of a board", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("draws the deployed diagram with its counts and opens the process at a clicked count", async () => {
    harness = mountApp()
    harness.publish(ready(PROCESS_BOARD_VIEW))
    const cluster = await waitForElement<HTMLElement>(
      harness.root,
      '.board-card--processDiagram [data-badge-for="Activity_ShipOrder"]',
    )
    const diagram = harness.root.querySelector(".board-card--processDiagram")!

    expect(diagram.textContent).toContain("local · v3, the latest version")
    expect(diagram.querySelector('[aria-label="Diagram of Order fulfillment on local"]')).not.toBe(
      null,
    )
    cluster.querySelector<HTMLButtonElement>('[data-scope="withIncident"]')?.click()
    buttonNamed(diagram, "Open process").click()
    expect(harness.posted).toEqual([
      {
        type: "openBoardProcess",
        engine: "local",
        bpmnProcessId: "order-fulfillment",
        filter: { scope: "withIncident", elementId: "Activity_ShipOrder" },
        toSide: false,
      },
      {
        type: "openBoardProcess",
        engine: "local",
        bpmnProcessId: "order-fulfillment",
        filter: { scope: "running" },
        toSide: false,
      },
    ])
  })

  it("opens the process at a clicked element only where the diagram counts something", async () => {
    harness = mountApp()
    harness.publish(ready(PROCESS_BOARD_VIEW))
    const hit = (elementId: string) =>
      harness.root.querySelector(
        `.board-card--processDiagram g.djs-element[data-element-id="${elementId}"] .djs-hit`,
      )
    await waitForElement(
      harness.root,
      '.board-card--processDiagram [data-badge-for="Activity_CheckCredit"]',
    )

    hit("Activity_ApproveOrder")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    )
    hit("Activity_CheckCredit")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    )

    expect(harness.posted).toEqual([
      {
        type: "openBoardProcess",
        engine: "local",
        bpmnProcessId: "order-fulfillment",
        filter: { scope: "running", elementId: "Activity_CheckCredit" },
        toSide: false,
      },
    ])
  })

  it("says why a diagram is missing", async () => {
    const unread = {
      ...PROCESS_BOARD_VIEW,
      rows: [
        [
          {
            kind: "processDiagram",
            title: "Unread",
            engine: "prod-eu",
            bpmnProcessId: "order-fulfillment",
          },
        ],
        ...PROCESS_BOARD_VIEW.rows,
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(unread))
    await waitForElement(harness.root, ".board-card--processDiagram")

    expect(texts(harness.root, ".board-card--processDiagram .empty-hint")).toEqual([
      "The diagram was not read from prod-eu.",
      "order-fulfillment is not deployed on shop-test.",
    ])
  })

  it("lists open incidents with their messages and opens the instance on its engine", async () => {
    harness = mountApp()
    harness.publish(ready(PROCESS_BOARD_VIEW))
    await waitForElement(harness.root, ".board-card--incidentList tbody tr")
    const list = harness.root.querySelector(".board-card--incidentList")!

    expect(texts(list, "th")).toEqual(["Engine", "Process", "Element", "Message", "Since"])
    expect(texts(list, "tbody tr td:nth-child(4)")).toEqual([
      "Carrier API answered 503",
      "Carrier API answered 503",
    ])
    expect(texts(list, ".board-groups__note")).toEqual([
      "local: first 2, more open",
      "shop-test: not read",
    ])

    list.querySelector<HTMLTableRowElement>("tbody tr")?.click()
    expect(harness.posted).toEqual([
      {
        type: "openBoardInstance",
        engine: "local",
        instanceId: "4c1f0a2e-3c1d-instance",
        toSide: false,
      },
    ])
  })

  it("leaves out the engine column over one engine and says when nothing is open", async () => {
    const calm = {
      ...PROCESS_BOARD_VIEW,
      rows: [
        [
          {
            kind: "incidentList",
            title: "Calm",
            groups: [{ engine: "local", rows: [] }],
          },
        ],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(calm))
    const list = await waitForElement(harness.root, ".board-card--incidentList")

    expect(texts(list, "th")).toEqual(["Process", "Element", "Message", "Since"])
    expect(list.textContent).toContain("No open incident on the engines that answered.")
    expect(texts(list, ".board-groups__note")).toEqual(["local: 0 open"])
  })

  it("says so when no engine was read", async () => {
    const unread = {
      ...PROCESS_BOARD_VIEW,
      rows: [
        [
          {
            kind: "incidentList",
            title: "Unread",
            groups: [{ engine: "local", rows: [], unavailable: true }],
          },
        ],
      ],
    } satisfies BoardView
    harness = mountApp()
    harness.publish(ready(unread))
    const list = await waitForElement(harness.root, ".board-card--incidentList")

    expect(list.textContent).toContain("No engine was read.")
  })
})
