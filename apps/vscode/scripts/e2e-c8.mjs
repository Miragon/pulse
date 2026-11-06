import { resolve } from "node:path"
import { driveVscode, panelFrame, runCommand, shot } from "./support/vscode-driver.mjs"

const WORKSPACE = resolve("dev/host/workspace-c8")
const CLUSTER = "http://localhost:18088/v2"
const LOGINS = {
  none: { profile: "c8-open" },
  basic: {
    profile: "c8-basic",
    identity: ["Username", "reader"],
    secret: ["Password", "reader-password"],
  },
  oidc: {
    profile: "c8-oidc",
    identity: ["Client ID", "pulse-reader"],
    secret: ["Client secret", "reader-secret"],
  },
}
const SECURITY = process.env.PULSE_C8_SECURITY ?? "none"
const LOGIN = LOGINS[SECURITY]
const LOADED = 60_000

async function clusterIsUp() {
  const response = await fetch(`${CLUSTER}/topology`).catch(() => undefined)
  if (response === undefined) {
    throw new Error(`No cluster at ${CLUSTER}. Run "pnpm --filter pulse-cockpit run c8:up" first.`)
  }
}

async function answerInput(window, [label, value]) {
  await window
    .locator(".quick-input-title", { hasText: `${label} for ${LOGIN.profile}` })
    .waitFor({ timeout: 30_000 })
  await window.keyboard.type(value)
  await window.keyboard.press("Enter")
}

async function setCredentials(window) {
  await runCommand(window, "Pulse: Set Credentials")
  const input = window.locator(".quick-input-widget input")
  await window.locator(".quick-input-list-row", { hasText: LOGIN.profile }).first().waitFor()
  await input.fill(LOGIN.profile)
  await input.press("Enter")
  await answerInput(window, LOGIN.identity)
  await answerInput(window, LOGIN.secret)
}

async function pickEngine(window) {
  await runCommand(window, "Pulse: Switch Engine")
  await window.locator(".quick-input-list-row", { hasText: LOGIN.profile }).first().click()
}

function engineItem(window, name) {
  return window.getByRole("treeitem", { name: new RegExp(`^${name}, `) })
}

const LISTED = [
  "the Pulse view lists the Camunda 8 profiles",
  async (window) => {
    await window.locator('.activitybar [aria-label^="Pulse"]').first().click()
    for (const profile of Object.values(LOGINS)) {
      await engineItem(window, profile.profile).waitFor({ timeout: 30_000 })
    }
    await shot(window, "c8-01-engines-tree")
  },
]

const ASKS_FOR_CREDENTIALS = [
  "a secured profile without credentials asks for them",
  async (window) => {
    await engineItem(window, LOGIN.profile).locator(".monaco-tl-twistie").click({ force: true })
    await window
      .getByRole("treeitem", { name: new RegExp(`${LOGIN.profile}.*(credentials|log in)`, "i") })
      .first()
      .waitFor({ timeout: LOADED })
    await shot(window, "c8-02-asks-for-credentials")
  },
]

const SET_CREDENTIALS = [
  "Set Credentials takes the login and the engine answers",
  async (window) => {
    await setCredentials(window)
    await window
      .getByRole("treeitem", { name: /^Order fulfillment, / })
      .first()
      .waitFor({ timeout: LOADED })
    await shot(window, "c8-03-after-credentials")
  },
]

const STEPS = [
  LISTED,
  ...(LOGIN.identity === undefined ? [] : [ASKS_FOR_CREDENTIALS, SET_CREDENTIALS]),
  [
    "the engine names its product and says it is read-only",
    async (window) => {
      await window
        .getByRole("treeitem", {
          name: new RegExp(
            `^${LOGIN.profile}, LOCAL · Camunda 8 8\\.\\d+\\.\\d+, read-only engine$`,
          ),
        })
        .waitFor({ timeout: LOADED })
    },
  ],
  [
    "a process definition opens with badges and instances, and offers no writes",
    async (window) => {
      await window
        .getByRole("treeitem", { name: /^Order fulfillment, / })
        .first()
        .click()
      const frame = await panelFrame(window)
      await frame.locator(".context-bar", { hasText: "As of" }).waitFor({ timeout: 30_000 })
      await frame
        .locator(".djs-overlay-pulse-badges .count-badge")
        .first()
        .waitFor({ timeout: 30_000 })
      await frame.getByRole("row", { name: /ORD-2009/ }).waitFor({ timeout: 30_000 })
      if ((await frame.getByRole("checkbox", { name: "Select all shown instances" }).count()) > 0) {
        throw new Error("a read-only engine offers bulk selection")
      }
      await shot(window, "c8-04-definition-panel")
    },
  ],
  [
    "an instance with an incident shows the worker's error",
    async (window) => {
      await (await panelFrame(window)).getByText("ORD-2009").click()
      await window.waitForTimeout(500)
      const instance = await panelFrame(window)
      await instance.getByText("ConnectException").first().waitFor({ timeout: 30_000 })
      await instance.getByText("Worker error").first().waitFor()
      await shot(window, "c8-05-instance-incident")
    },
  ],
  [
    "the error message opens as a read-only document",
    async (window) => {
      await (
        await panelFrame(window)
      )
        .getByRole("button", { name: /error message/i })
        .first()
        .click()
      await window
        .locator(".monaco-editor .view-lines", { hasText: "Caused by:" })
        .first()
        .waitFor({ timeout: 30_000 })
      await shot(window, "c8-06-error-document")
    },
  ],
  [
    "Go to Process Instance asks between a parent and its called instance, which share a business key",
    async (window) => {
      await runCommand(window, "View: Close All Editors")
      await pickEngine(window)
      await runCommand(window, "Pulse: Go to Process Instance")
      const input = window.locator(".quick-input-widget input")
      await window.locator(".quick-input-title", { hasText: LOGIN.profile }).waitFor()
      await input.fill("DSP-3002")
      await input.press("Enter")
      await window.locator(".quick-input-title", { hasText: "2 instances" }).waitFor()
      await window.locator(".quick-input-list-row", { hasText: "Dispatch order" }).first().click()
      await (
        await panelFrame(window)
      )
        .locator(".incident-card dt", { hasText: "Located in" })
        .first()
        .waitFor({ timeout: 30_000 })
      await shot(window, "c8-07-called-instance-incident")
    },
  ],
  [
    "a click on an engine opens its overview",
    async (window) => {
      await runCommand(window, "View: Close All Editors")
      await engineItem(window, LOGIN.profile).click()
      await window
        .locator(".tab.active", { hasText: `${LOGIN.profile} · Processes` })
        .waitFor({ timeout: 30_000 })
      const overview = await panelFrame(window)
      await overview.getByRole("row", { name: /Order fulfillment/ }).waitFor({ timeout: 30_000 })
      await overview.getByRole("row", { name: /Dispatch order/ }).waitFor()
      await shot(window, "c8-08-engine-overview")
    },
  ],
]

await clusterIsUp()
await driveVscode(WORKSPACE, STEPS)
