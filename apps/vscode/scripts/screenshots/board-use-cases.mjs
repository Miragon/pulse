import { rm, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { restPointer } from "./panel-steps.mjs"
import {
  answer,
  closeEditors,
  openFile,
  panelFrame,
  runCommand,
  showPulse,
} from "./vscode-driver.mjs"
import { part } from "../support/webview-parts.mjs"

const BROKEN_BOARD = fileURLToPath(
  new URL("../../sandbox/.pulse/boards/broken.board.json", import.meta.url),
)

async function openBoard(window, title) {
  await showPulse(window)
  await window
    .getByRole("treeitem", { name: new RegExp(`^${title}, .*\\.board\\.json`) })
    .first()
    .click()
  await panelFrame(window)
    .locator(part("context-bar", { kind: "board" }), { hasText: "As of" })
    .waitFor({
      timeout: 60_000,
    })
  await window.waitForTimeout(1500)
}

async function signInToTest(window) {
  await runCommand(window, "Pulse: Set Credentials")
  await answer(window, "shop-test")
  await answer(window, "demo")
  await answer(window, "demo")
  await window.waitForTimeout(1500)
}

export const BOARD_USE_CASES = [
  {
    file: "board-file",
    title: "A board is a JSON file in the repository",
    shows:
      "`.pulse/boards/shop-operations.board.json` names three engines and five widgets; the schema completes and checks every key.",
    run: async (window) => {
      await closeEditors(window)
      await openFile(window, "shop-operations.board.json")
      await showPulse(window)
      await restPointer(window)
    },
  },
  {
    file: "board-across-engines",
    title: "One board across several engines",
    shows:
      "The Boards view lists the board; the panel counts and lists across shop-dev and shop-test, every row and number keeps its engine, and the unreachable prod-eu only empties its own cells.",
    run: async (window) => {
      await closeEditors(window)
      await showPulse(window)
      await signInToTest(window)
      await openBoard(window, "Shop operations")
      await restPointer(window)
    },
  },
  {
    file: "board-opens-instance",
    title: "A board row opens the instance on its engine",
    shows: "A click on a row opens that instance in the instance panel of the engine it came from.",
    run: async (window) => {
      await openBoard(window, "Shop operations")
      await panelFrame(window)
        .locator('[data-part="board-card"][data-kind="instanceList"] tbody tr')
        .first()
        .click()
      await panelFrame(window)
        .locator(part("context-bar", { kind: "instance" }), { hasText: "As of" })
        .waitFor({
          timeout: 30_000,
        })
      await restPointer(window)
      await window.waitForTimeout(900)
    },
  },
  {
    file: "board-problems",
    title: "A broken widget says where and why, in its place",
    shows:
      "A board with a contradicting filter, an unknown widget and a key Pulse does not know: the tree counts its problems, each broken widget lists its problems with path and reason where it would be, the counter beside them reads, and the unknown key is a note.",
    run: async (window) => {
      await closeEditors(window)
      await writeFile(
        BROKEN_BOARD,
        `${JSON.stringify(
          {
            title: "Broken board",
            engines: ["shop-dev"],
            layout: "wide",
            rows: [
              {
                row: [
                  {
                    widget: "counter",
                    props: {
                      title: "Waiting for shipping",
                      filter: { activeElement: "Activity_ShipOrder" },
                    },
                  },
                  {
                    widget: "counter",
                    props: { title: "Running orders", filter: { process: "order-fulfillment" } },
                  },
                ],
              },
              { row: [{ widget: "chart" }] },
            ],
          },
          undefined,
          2,
        )}\n`,
      )
      await showPulse(window)
      const item = window
        .getByRole("treeitem", { name: /^Broken board, broken\.board\.json/ })
        .first()
      await item.waitFor({ timeout: 30_000 })
      await item.click()
      await panelFrame(window)
        .locator(part("board-card", { kind: "refused" }))
        .first()
        .waitFor({ timeout: 30_000 })
      await panelFrame(window)
        .locator(part("context-bar", { kind: "board" }), { hasText: "As of" })
        .waitFor({ timeout: 30_000 })
      await restPointer(window)
      await window.waitForTimeout(900)
    },
    after: async () => {
      await rm(BROKEN_BOARD, { force: true })
    },
  },
  {
    file: "board-process",
    title: "A board around one process",
    shows:
      "`order-fulfillment.board.json` draws the deployed diagram on shop-dev and shop-test with waiting and incident badges, lists the open incidents of both engines with element and message, and the running orders below.",
    run: async (window) => {
      await closeEditors(window)
      await showPulse(window)
      await signInToTest(window)
      await openBoard(window, "Order fulfillment")
      await panelFrame(window)
        .locator('[data-part="board-card"][data-kind="processDiagram"] [data-badge-for]')
        .first()
        .waitFor({
          timeout: 30_000,
        })
      await restPointer(window)
      await window.waitForTimeout(900)
    },
  },
  {
    file: "board-diagram-opens-element",
    title: "A count in a board diagram opens the process there",
    shows:
      "A click on the incident count at an element opens the process on that engine, filtered to the instances with incident at that element.",
    run: async (window) => {
      await openBoard(window, "Order fulfillment")
      await panelFrame(window)
        .locator('[data-part="board-card"][data-kind="processDiagram"] [data-scope="withIncident"]')
        .first()
        .click()
      await panelFrame(window)
        .locator(part("context-bar", { kind: "definition" }), { hasText: "As of" })
        .waitFor({
          timeout: 30_000,
        })
      await restPointer(window)
      await window.waitForTimeout(900)
    },
  },
]
