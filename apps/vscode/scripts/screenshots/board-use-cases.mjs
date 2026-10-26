import { rm, writeFile } from "node:fs/promises"
import { restPointer } from "./panel-steps.mjs"
import {
  answer,
  closeEditors,
  openFile,
  panelFrame,
  runCommand,
  showPulse,
} from "./vscode-driver.mjs"

const BROKEN_BOARD = "sandbox/.pulse/boards/broken.board.json"

async function openBoard(window, title) {
  await showPulse(window)
  await window
    .getByRole("treeitem", { name: new RegExp(`^${title}`) })
    .first()
    .click()
  await panelFrame(window).locator(".context-bar--board", { hasText: "As of" }).waitFor({
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
      await panelFrame(window).locator(".board-card--instanceList tbody tr").first().click()
      await panelFrame(window).locator(".context-bar--instance", { hasText: "As of" }).waitFor({
        timeout: 30_000,
      })
      await restPointer(window)
      await window.waitForTimeout(900)
    },
  },
  {
    file: "board-problems",
    title: "A broken board says where and why",
    shows:
      "A board with a contradicting filter and an unknown widget: the tree marks it and the panel lists each problem with its path and reason.",
    run: async (window) => {
      await closeEditors(window)
      await writeFile(
        BROKEN_BOARD,
        `${JSON.stringify(
          {
            title: "Broken board",
            engines: ["shop-dev"],
            rows: [
              {
                row: [
                  { widget: "counter", props: { filter: { activeElement: "Activity_ShipOrder" } } },
                  { widget: "chart" },
                ],
              },
            ],
          },
          undefined,
          2,
        )}\n`,
      )
      await showPulse(window)
      const item = window.getByRole("treeitem", { name: /^broken\.board\.json/ }).first()
      await item.waitFor({ timeout: 30_000 })
      await item.click()
      await panelFrame(window).locator(".status-strip", { hasText: "problems in" }).waitFor({
        timeout: 30_000,
      })
      await restPointer(window)
      await window.waitForTimeout(900)
    },
    after: async () => {
      await rm(BROKEN_BOARD, { force: true })
    },
  },
]
