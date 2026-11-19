import { enlargeList, restPointer } from "../../apps/vscode/scripts/screenshots/panel-steps.mjs"
import {
  closeEditors,
  launchVsCode,
  MODIFIER,
  showPulse,
} from "../../apps/vscode/scripts/screenshots/vscode-driver.mjs"
import { part } from "../../apps/vscode/scripts/support/webview-parts.mjs"

const SANDBOX_ENGINE = "http://localhost:18090/engine-rest/version"
const INSTANCE = "ORD-10130"

async function sandboxIsUp() {
  const response = await fetch(SANDBOX_ENGINE).catch(() => undefined)
  if (response?.ok !== true) {
    throw new Error(
      "The sandbox is not running. Start it with: pnpm --filter pulse-cockpit run sandbox:up",
    )
  }
}

async function quietTitleBar(window) {
  await window.addStyleTag({
    content: `
      .monaco-workbench .part.titlebar .menubar,
      .monaco-workbench .part.titlebar .window-appicon { display: none !important; }
      .monaco-workbench .part.titlebar > .titlebar-container > .titlebar-left { min-width: 76px !important; }
    `,
  })
  await window.evaluate(() => {
    const title = globalThis.document.querySelector(".window-title")
    if (!title) return
    const plain = () => {
      const text = title.textContent.replace("[Extension Development Host] ", "")
      if (text !== title.textContent) {
        title.textContent = text
      }
    }
    new globalThis.MutationObserver(plain).observe(title, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    plain()
  })
}

export async function open() {
  await sandboxIsUp()
  const vscode = await launchVsCode("sandbox")
  await showPulse(vscode.window)
  await closeEditors(vscode.window)
  await quietTitleBar(vscode.window)
  await restPointer(vscode.window)
  return { page: vscode.window, close: vscode.close }
}

async function pause(window, milliseconds) {
  await restPointer(window)
  await window.waitForTimeout(milliseconds)
}

async function panelShowing(window, selector, text) {
  for (let attempt = 0; attempt < 60; attempt++) {
    for (const frame of window.frames()) {
      const outer = await frame
        .parentFrame()
        ?.frameElement()
        .catch(() => undefined)
      const found = await frame
        .locator(selector, text === undefined ? {} : { hasText: text })
        .count()
        .catch(() => 0)
      if (found > 0 && (await outer?.isVisible().catch(() => false))) {
        return frame
      }
    }
    await window.waitForTimeout(500)
  }
  throw new Error(`No visible Pulse panel shows ${selector}`)
}

const visiblePanel = (window) => panelShowing(window, part("context-bar"))

async function clickUntil(target, result) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await target.click()
    if (
      await result.waitFor({ timeout: 2500 }).then(
        () => true,
        () => false,
      )
    ) {
      return
    }
  }
  throw new Error(`Clicking ${String(target)} had no effect`)
}

async function clickTab(window, name) {
  const tab = (await visiblePanel(window)).getByRole("tab", { name: new RegExp(`^${name}`) })
  await clickUntil(tab, tab.and((await visiblePanel(window)).locator('[aria-selected="true"]')))
  await window.waitForTimeout(600)
}

async function fromEngineToInstance(window) {
  await showPulse(window)
  await pause(window, 800)
  await window.getByRole("treeitem", { name: /^shop-dev, / }).click()
  const processes = await panelShowing(window, "tbody tr", "Order fulfillment")
  await pause(window, 1200)
  await processes
    .getByRole("row", { name: /Order fulfillment/ })
    .first()
    .click()
  const definition = await panelShowing(window, '[placeholder="Business key"]')
  await pause(window, 1200)
  const search = definition.getByPlaceholder("Business key")
  await search.pressSequentially(INSTANCE, { delay: 40 })
  await search.press("Enter")
  await panelShowing(window, "tbody tr", INSTANCE)
  await window.waitForTimeout(800)
  await definition
    .getByRole("row", { name: new RegExp(INSTANCE) })
    .first()
    .click()
  await panelShowing(window, '[data-part="incident-card"]')
}

async function fixCardExpiry(window) {
  await enlargeList(window)
  await pause(window, 2200)
  await clickTab(window, "Variables")
  const frame = await visiblePanel(window)
  await frame.getByRole("row", { name: /cardExpiry/ }).hover()
  const field = frame.getByRole("textbox", { name: "New value" })
  await clickUntil(frame.getByRole("button", { name: "Edit cardExpiry" }), field)
  await field.fill("")
  await field.pressSequentially("12/2030", { delay: 60 })
  await window.waitForTimeout(500)
  await field.press(`${MODIFIER}+Enter`)
  await frame
    .locator(`[data-part="strips"] ${part("status-strip")}`, { hasText: "Changed cardExpiry" })
    .waitFor({ timeout: 30_000 })
  await pause(window, 1000)
}

async function retry(window) {
  await clickTab(window, "Incidents")
  const frame = await visiblePanel(window)
  const card = frame.locator('[data-part="incident-card"]')
  await clickUntil(
    card.getByRole("button", { name: "Retry", exact: true }),
    frame.locator(part("status-strip"), { hasText: /Retried|Waiting at/ }),
  )
  await card.waitFor({ state: "detached", timeout: 90_000 })
  await pause(window, 2500)
}

export default async function fixExpiredCard(window) {
  await fromEngineToInstance(window)
  await fixCardExpiry(window)
  await retry(window)
}
