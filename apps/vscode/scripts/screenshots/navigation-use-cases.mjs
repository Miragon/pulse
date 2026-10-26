import {
  enlargeList,
  expectTooltip,
  goToInstanceOf,
  openDefinition,
  restPointer,
  startColumnDrag,
  waitForPanel,
} from "./panel-steps.mjs"
import { closeEditors, goToInstance, panelFrame, selectTab, showPulse } from "./vscode-driver.mjs"

const SHIP_ORDER_CALL = '[data-call-for="Activity_ShipOrder"]'
const CHARGE_PAYMENT_BADGE = '[data-badge-for="Activity_ChargePayment"]'
const SHIP_ORDER_TOOLTIP = "Open called process Shipment"
const COCKPIT_TOOLTIP = "Open ORD-10129 in Cockpit on shop-dev"

export const NAVIGATION_USE_CASES = [
  {
    file: "definition-filter-with-incident",
    title: "Filter the instances by scope, with counts",
    shows:
      "One filter bar above the instances: every scope carries its count, the incident count in red; With incident lists only the instances of v3 with an incident. Search and the legend button share the bar.",
    run: async (window) => {
      await openDefinition(window)
      const frame = panelFrame(window)
      await frame.getByRole("radio", { name: /^With incident/ }).click()
      await frame
        .locator('.segmented[aria-busy="false"] [aria-checked="true"]', {
          hasText: "With incident",
        })
        .waitFor()
      await restPointer(window)
    },
  },
  {
    file: "definition-filter-by-badge",
    title: "Filter the instances by a badge count",
    shows:
      "A click on the red count of Charge payment lists the instances with an incident there: the scope switches to With incident and the chip says At Charge payment. The blue count lists the running ones.",
    run: async (window) => {
      await openDefinition(window)
      const frame = panelFrame(window)
      await frame.locator(`${CHARGE_PAYMENT_BADGE} [data-scope="withIncident"]`).click()
      await frame.locator(".filter-chip", { hasText: "Charge payment" }).waitFor()
      await frame
        .locator('.segmented[aria-busy="false"] [aria-checked="true"]', {
          hasText: "With incident",
        })
        .waitFor()
      await restPointer(window)
    },
  },
  {
    file: "resize-table-columns",
    title: "Resize a table column",
    shows:
      'Dragging the right edge of Value widens the column, so the JSON and text values show more before they end in "…"; the blue line marks the edge being dragged.',
    run: async (window) => {
      await closeEditors(window)
      await goToInstance(window, "ORD-10119")
      await selectTab(window, "Variables")
      await enlargeList(window)
      await startColumnDrag(window, "Value", 300)
    },
    after: async (window) => {
      await window.mouse.up()
    },
  },
  {
    file: "call-activity-jump-button",
    title: "The jump button on a call activity",
    shows: `Under Ship order sits an arrow button, here with keyboard focus; its tooltip says "${SHIP_ORDER_TOOLTIP}". A click on the shape itself still filters the list.`,
    run: async (window) => {
      await openDefinition(window)
      const button = panelFrame(window).locator(SHIP_ORDER_CALL)
      await expectTooltip(button, SHIP_ORDER_TOOLTIP)
      await button.focus()
      await button.press("Shift")
      await restPointer(window)
    },
  },
  {
    file: "called-process-opened",
    title: "The called process in its own tab",
    shows:
      "The arrow opens the Shipment definition in another editor tab, with its own badges and instances; the order stays open in its tab.",
    run: async (window) => {
      await panelFrame(window).locator(SHIP_ORDER_CALL).click()
      await window.locator(".tab.active", { hasText: "Shipment" }).waitFor({ timeout: 30_000 })
      await waitForPanel(window)
      await restPointer(window)
    },
  },
  {
    file: "called-instance-parent-link",
    title: "A called instance links back to its caller",
    shows:
      'From ORD-10137 the arrow under Ship order opens the shipment it called; the shipment’s header says "from" with the short id of the order and leads back to it.',
    run: async (window) => {
      await closeEditors(window)
      await goToInstanceOf(window, "ORD-10137", "Order fulfillment")
      await panelFrame(window).locator(SHIP_ORDER_CALL).click()
      await window.locator(".tab.active", { hasText: "Shipment" }).waitFor({ timeout: 30_000 })
      await panelFrame(window).locator(".context-bar", { hasText: "from " }).waitFor({
        timeout: 30_000,
      })
      await waitForPanel(window)
      await restPointer(window)
    },
  },
  {
    file: "open-in-cockpit",
    title: "An instance links into Cockpit",
    shows: `Where Pulse stops, the engine's web UI goes on: shop-dev has a cockpitUrl, so Open in Cockpit (hovered) follows Copy handover. Its tooltip, "${COCKPIT_TOOLTIP}", is drawn by the OS and not part of the screenshot.`,
    run: async (window) => {
      await closeEditors(window)
      await goToInstance(window, "ORD-10129")
      const button = panelFrame(window).getByRole("button", { name: "Open in Cockpit" })
      await expectTooltip(button, COCKPIT_TOOLTIP)
      await button.hover()
      await window.waitForTimeout(900)
    },
  },
]

export const ENGINE_OVERVIEW_USE_CASES = [
  {
    file: "engine-overview",
    title: "The processes of an engine at a glance",
    shows:
      "A click on shop-dev in the Engines view opens its overview: product and version, access, Refresh and Open in Cockpit in the header; one filter bar with the scopes and their counts, a search by name or key and the summary of the engine; the processes with incidents first, their incident counts in red. A row opens the process, Ctrl/Cmd+click to the side.",
    run: async (window) => {
      await closeEditors(window)
      await showPulse(window)
      await window.getByRole("treeitem", { name: /^shop-dev, / }).click()
      await window
        .locator(".tab.active", { hasText: "shop-dev · Processes" })
        .waitFor({ timeout: 30_000 })
      await waitForPanel(window)
      await restPointer(window)
    },
  },
]
