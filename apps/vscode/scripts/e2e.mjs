import { resolve } from "node:path"
import { driveVscode, panelFrame, runCommand, shot } from "./support/vscode-driver.mjs"

const WORKSPACE = resolve("dev/host/workspace")
const ENGINE = "http://localhost:18080/engine-rest"

async function engineIsUp() {
  const response = await fetch(`${ENGINE}/version`).catch(() => undefined)
  if (response?.ok !== true) {
    throw new Error(
      `No engine at ${ENGINE}. Run "pnpm --filter pulse-cockpit run engine:up" first.`,
    )
  }
}

async function openModel(window, fileName) {
  await runCommand(window, "View: Show Explorer")
  await window.getByRole("treeitem", { name: fileName, exact: true }).click()
  await window.locator(".tab.active", { hasText: fileName }).waitFor({ timeout: 30_000 })
  await runCommand(window, "Pulse: Show Runtime Data for This Model")
}

const STEPS = [
  [
    "the Pulse view lists the engines",
    async (window) => {
      await window.locator('.activitybar [aria-label^="Pulse"]').first().click()
      await window.getByRole("treeitem", { name: /local-operaton/ }).waitFor({ timeout: 30_000 })
      await window
        .getByRole("treeitem", { name: /^Order fulfillment, / })
        .waitFor({ timeout: 30_000 })
      await window.getByRole("treeitem", { name: /prod-eu/ }).waitFor()
      await shot(window, "01-engines-tree")
    },
  ],
  [
    "an engine keeps its product name and says whether it is writable after a refresh",
    async (window) => {
      const named = window.getByRole("treeitem", {
        name: /^local-operaton, LOCAL · Operaton .+, writable engine$/,
      })
      await named.waitFor({ timeout: 30_000 })
      await window.getByRole("treeitem", { name: /^prod-eu, .+, read-only engine$/ }).waitFor()
      await runCommand(window, "Pulse: Refresh")
      await window.waitForTimeout(2000)
      await named.waitFor({ timeout: 5_000 })
    },
  ],
  [
    "a process definition opens with badges and instances",
    async (window) => {
      await window.getByRole("treeitem", { name: /^Order fulfillment, / }).click()
      const frame = await panelFrame(window)
      await frame.locator(".context-bar", { hasText: "As of" }).waitFor({ timeout: 30_000 })
      await frame
        .locator(".djs-overlay-pulse-badges .count-badge")
        .first()
        .waitFor({ timeout: 30_000 })
      await shot(window, "02-definition-panel")
    },
  ],
  [
    "an instance with an incident shows its root cause",
    async (window) => {
      await (await panelFrame(window)).getByText("ORD-2009").click()
      await window.waitForTimeout(500)
      const instance = await panelFrame(window)
      await instance.getByText("PropertyNotFoundException").first().waitFor({ timeout: 30_000 })
      await shot(window, "03-instance-incident")
    },
  ],
  [
    "the stack trace opens as a read-only document",
    async (window) => {
      await (
        await panelFrame(window)
      )
        .getByRole("button", { name: /stacktrace/i })
        .first()
        .click()
      await window
        .locator(".tab", { hasText: /^Incident .*\.log/ })
        .first()
        .waitFor({ timeout: 30_000 })
      await window
        .locator(".monaco-editor .view-lines", { hasText: "Caused by:" })
        .first()
        .waitFor({ timeout: 30_000 })
      await shot(window, "04-stacktrace-document")
    },
  ],
  [
    "Go to Process Instance finds a business key",
    async (window) => {
      await runCommand(window, "Pulse: Go to Process Instance")
      await window
        .locator(".quick-input-title", { hasText: "Go to Process Instance" })
        .waitFor({ timeout: 10_000 })
      const input = window.locator(".quick-input-widget input")
      await input.fill("DSP-3002")
      await input.press("Enter")
      await (
        await panelFrame(window)
      )
        .locator(".incident-card dt", { hasText: "Located in" })
        .first()
        .waitFor({ timeout: 30_000 })
      await shot(window, "05-called-instance-incident")
    },
  ],
  [
    "a production engine that cannot be reached says so",
    async (window) => {
      await window
        .getByRole("treeitem", { name: /prod-eu/ })
        .locator(".monaco-tl-twistie")
        .click()
      await window
        .getByRole("treeitem", { name: /Can't reach prod-eu/ })
        .waitFor({ timeout: 60_000 })
      await shot(window, "06-unreachable-production")
    },
  ],
  [
    "the overview of an engine that cannot be reached says so instead of staying blank",
    async (window) => {
      await window.getByRole("treeitem", { name: /^prod-eu, / }).click()
      await window
        .locator(".tab.active", { hasText: "prod-eu · Processes" })
        .waitFor({ timeout: 30_000 })
      await (
        await panelFrame(window)
      )
        .getByText("Can't reach prod-eu.")
        .waitFor({ timeout: 60_000 })
      await shot(window, "07-unreachable-overview")
      await window.locator(".statusbar").click({ position: { x: 800, y: 8 } })
    },
  ],
  [
    "a changed model is flagged as differing from the engine",
    async (window) => {
      await openModel(window, "order-draft.bpmn")
      await (
        await panelFrame(window)
      )
        .getByText("differs from every deployed version")
        .waitFor({ timeout: 30_000 })
      await shot(window, "08-drift-differs")
    },
  ],
  [
    "an unchanged model matches its deployed version",
    async (window) => {
      await openModel(window, "order.bpmn")
      await (
        await panelFrame(window)
      )
        .getByText("matches the deployed v2")
        .waitFor({ timeout: 30_000 })
      await shot(window, "09-drift-matches")
    },
  ],
  [
    "a click on an engine opens its overview, a row the process, selected in the tree",
    async (window) => {
      await window.locator('.activitybar [aria-label^="Pulse"]').first().click({ force: true })
      await window.getByRole("treeitem", { name: /^local-operaton, / }).click()
      await window
        .locator(".tab.active", { hasText: "local-operaton · Processes" })
        .waitFor({ timeout: 30_000 })
      const overview = await panelFrame(window)
      const order = overview.getByRole("row", { name: /Order fulfillment/ })
      await order.waitFor({ timeout: 30_000 })
      await overview.getByRole("row", { name: /Dispatch order/ }).waitFor()
      await shot(window, "10-engine-overview")
      await order.click()
      await window
        .locator(".tab.active", { hasText: "Order fulfillment · local-operaton" })
        .waitFor({ timeout: 30_000 })
      await window
        .getByRole("treeitem", { name: /^Order fulfillment, /, selected: true })
        .waitFor({ timeout: 10_000 })
    },
  ],
  [
    "selected instances of an older version open a migration with the generated plan",
    async (window) => {
      await window.locator(".statusbar").click({ position: { x: 800, y: 8 } })
      await runCommand(window, "View: Close All Editors")
      await window.getByRole("treeitem", { name: /^Order fulfillment, / }).click()
      await window
        .locator(".tab.active", { hasText: "Order fulfillment · local-operaton" })
        .waitFor({ timeout: 30_000 })
      const definition = await panelFrame(window)
      const picker = definition.locator("select.version-picker__select")
      const v1 = await picker.locator("option", { hasText: /^v1 / }).getAttribute("value")
      await picker.selectOption(v1)
      await definition.getByRole("row", { name: /ORD-1001/ }).waitFor({ timeout: 30_000 })
      await definition.getByRole("checkbox", { name: "Select all shown instances" }).check()
      await definition.getByRole("button", { name: "Migrate to version…" }).click()
      await window
        .locator(".tab.active", { hasText: "Order fulfillment v1 → v2 · local-operaton" })
        .waitFor({ timeout: 30_000 })
      await (
        await panelFrame(window)
      )
        .getByText(/map by id · no problems/)
        .waitFor({ timeout: 30_000 })
      await shot(window, "11-migration-plan")
    },
  ],
]

await engineIsUp()
await driveVscode(WORKSPACE, STEPS)
