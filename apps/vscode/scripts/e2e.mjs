import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { downloadAndUnzipVSCode } from "@vscode/test-electron"
import { _electron as electron } from "playwright"

const EXTENSION = resolve(".")
const WORKSPACE = resolve("dev/host/workspace")
const SHOTS = resolve(process.env.PULSE_E2E_SHOTS ?? "test-results/e2e")
const MAC_INSTALLATION = "/Applications/Visual Studio Code.app/Contents/MacOS/Code"
const ENGINE = "http://localhost:18080/engine-rest"

async function vscodeExecutable() {
  if (process.env.PULSE_VSCODE_EXECUTABLE !== undefined) {
    return process.env.PULSE_VSCODE_EXECUTABLE
  }
  return existsSync(MAC_INSTALLATION) ? MAC_INSTALLATION : downloadAndUnzipVSCode("stable")
}

async function engineIsUp() {
  const response = await fetch(`${ENGINE}/version`).catch(() => undefined)
  if (response?.ok !== true) {
    throw new Error(`No engine at ${ENGINE}. Run "pnpm --filter pulse-vscode run engine:up" first.`)
  }
}

async function shot(window, name) {
  await window.screenshot({ path: join(SHOTS, `${name}.png`) })
  console.log(`screenshot ${name}.png`)
}

async function panelFrame(window) {
  const outer = window.frameLocator("iframe.webview.ready").last()
  return outer.frameLocator("iframe#active-frame")
}

async function runCommand(window, title) {
  await window.keyboard.press(process.platform === "darwin" ? "Meta+Shift+P" : "Control+Shift+P")
  await window.keyboard.type(title)
  await window.keyboard.press("Enter")
}

async function openModel(window, fileName) {
  await runCommand(window, "View: Show Explorer")
  await window.getByRole("treeitem", { name: fileName, exact: true }).click()
  await window.locator(".tab.active", { hasText: fileName }).waitFor({ timeout: 30_000 })
  await runCommand(window, "Pulse: Show Runtime Data for This Model")
}

async function step(name, action, window) {
  process.stdout.write(`• ${name} … `)
  try {
    await action()
  } catch (error) {
    await shot(window, "failed-step")
    throw error
  }
  console.log("ok")
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
      await window.keyboard.press(
        process.platform === "darwin" ? "Meta+Shift+P" : "Control+Shift+P",
      )
      await window.keyboard.type("Pulse: Go to Process Instance")
      await window.keyboard.press("Enter")
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
      await overview.getByRole("row", { name: /Invoice Receipt/ }).waitFor()
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

async function launch(userData) {
  return electron.launch({
    executablePath: await vscodeExecutable(),
    args: [
      WORKSPACE,
      `--extensionDevelopmentPath=${EXTENSION}`,
      `--user-data-dir=${userData}`,
      `--extensions-dir=${join(userData, "extensions")}`,
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-telemetry",
      "--new-window",
    ],
  })
}

async function run() {
  await engineIsUp()
  await mkdir(SHOTS, { recursive: true })
  const userData = await mkdtemp(join(tmpdir(), "pulse-e2e-"))
  const app = await launch(userData)
  const window = await app.firstWindow()
  try {
    for (const [name, action] of STEPS) {
      await step(name, () => action(window), window)
    }
  } finally {
    await app.close()
    await rm(userData, { recursive: true, force: true })
  }
}

await run()
