import { afterEach, describe, expect, it, vi } from "vitest"
import type { DefinitionView, PanelState } from "../../src/core/protocol/index.js"
import { DEFINITION_VIEW } from "../../dev/webview/fixtures/definition.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { DEFINITION_WORDING, DIALOG_WORDING } from "./definition-wording.expected.js"
import {
  allParts,
  allRoles,
  enterValue,
  findPart,
  findRole,
  getRole,
  mountApp,
  nextFrame,
  part,
  queryPart,
  waitForElement,
  type Harness,
} from "./harness.js"

const CLOCK = /(?:[A-Z][a-z]{2} \d{1,2}, )?\d{1,2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:\s?[AP]M)?/g
const RELATIVE = /\d+\s?[a-z]+\.?\s+ago|in \d+\s?[a-z]+\.?|just now|in under a minute/g

function timeless(text: string | null | undefined): string | null {
  return text === null || text === undefined
    ? null
    : text.replace(CLOCK, "<clock>").replace(RELATIVE, "<relative>")
}

function controlsOf(root: Element): (string | boolean | null)[][] {
  return [...root.querySelectorAll("button")].map((button) => [
    button.getAttribute("aria-label") ?? timeless(button.textContent),
    timeless(button.getAttribute("title")),
    button.disabled,
  ])
}

function radiosOf(bar: Element): (string | null)[][] {
  return allRoles(bar, "radio").map((radio) => [
    radio.textContent,
    radio.querySelector("[title]")?.getAttribute("title") ?? null,
  ])
}

function tableOf(root: Element) {
  const table = getRole<HTMLTableElement>(root, "table", { name: "Instances" })
  return {
    heads: [...table.querySelectorAll("th")].map((head) => head.textContent),
    rows: [...table.querySelectorAll("tbody tr")].map((row) => [
      row.getAttribute("aria-label"),
      ...[...row.querySelectorAll("td")].map((cell) => timeless(cell.textContent)),
    ]),
    empty: timeless(queryPart(root, "empty-hint")?.textContent),
    controls: controlsOf(table),
  }
}

function diagramOf(root: Element) {
  return {
    clusters: [...root.querySelectorAll("[data-badge-for]")].map((cluster) => [
      cluster.getAttribute("data-badge-for"),
      cluster.getAttribute("aria-label"),
    ]),
    counts: allParts(root, "badge-count").map((count) => [
      count.getAttribute("data-scope"),
      count.getAttribute("aria-label"),
      count.getAttribute("title"),
      count.textContent,
    ]),
    calls: allParts(root, "call-button").map((call) => [
      call.getAttribute("data-call-for"),
      call.getAttribute("aria-label"),
      call.getAttribute("title"),
      call.getAttribute("data-state"),
    ]),
  }
}

async function wordingOf(harness: Harness, state: PanelState) {
  harness.publish(state)
  const bar = await findPart(harness.root, "context-bar")
  await findRole(harness.root, "table", { name: "Instances" })
  await waitForElement(harness.root, "g.djs-element")
  await waitForElement(harness.root, "[data-badge-for]")
  await nextFrame()
  const select = bar.querySelector("select")
  const filterBar = await findPart(harness.root, "filter-bar")
  const legend = getRole<HTMLButtonElement>(filterBar, "button", { name: "Legend" })
  const search = getRole<HTMLInputElement>(filterBar, "searchbox")
  return {
    heading: getRole(bar, "heading", { level: 1 }).textContent,
    version: {
      label: select?.closest("label")?.textContent ?? null,
      options: [...(select?.options ?? [])].map((option) => option.text),
    },
    strips: timeless(queryPart(harness.root, "strips")?.textContent),
    stripControls: controlsOf(harness.root.querySelector(part("strips")) ?? harness.root),
    scopes: getRole(filterBar, "radiogroup").getAttribute("aria-label"),
    radios: radiosOf(filterBar),
    search: [search.getAttribute("aria-label"), search.placeholder, search.value],
    chips: allParts(filterBar, "filter-chip").map((chip) => timeless(chip.textContent)),
    filterControls: controlsOf(filterBar),
    legend: (legend.popoverTargetElement as HTMLElement).textContent,
    table: tableOf(harness.root),
    diagram: diagramOf(harness.root),
  }
}

const STATES = {
  definition: FIXTURES.definition,
  filtered: FIXTURES["definition-filtered"],
  ended: FIXTURES["definition-ended"],
  selecting: FIXTURES["definition-selecting"],
  camunda8: FIXTURES["definition-camunda8"],
  refreshing: FIXTURES.refreshing,
  conditions: {
    status: "ready",
    refreshing: false,
    view: {
      ...DEFINITION_VIEW,
      instances: [],
      hasMoreInstances: false,
      filter: {
        scope: "ended",
        variables: [
          { name: "route", operator: "equals", value: "review" },
          { name: "amount", operator: "greaterThan", value: "100" },
        ],
      },
      variableLabels: ['route = "review"', "amount > 100"],
      historyNote: "Ended and All update when you refresh.",
      scopeCounts: {
        running: 10000,
        withIncident: 3,
        ended: 0,
        all: 10000,
        atLeast: ["running", "all"],
      },
    },
  },
} satisfies Record<keyof typeof DEFINITION_WORDING, PanelState>

function fieldOf(dialog: HTMLDialogElement, label: string): HTMLInputElement & HTMLSelectElement {
  const target = [...dialog.querySelectorAll("label")].find(
    (candidate) => candidate.textContent === label,
  )
  return dialog.querySelector(`#${CSS.escape(target?.htmlFor ?? "")}`)!
}

function dialogOf(dialog: HTMLDialogElement) {
  return {
    heading: dialog.querySelector("h2")?.textContent ?? null,
    text: dialog.textContent,
    options: [...dialog.querySelectorAll("select")].map((select) =>
      [...select.options].map((option) => option.text),
    ),
    controls: controlsOf(dialog),
  }
}

async function dialogWording(harness: Harness, view: DefinitionView) {
  harness.publish({ status: "ready", refreshing: false, view })
  const opener = await vi.waitFor(() =>
    getRole(harness.root, "button", { name: /^Filter by variables/ }),
  )
  opener.click()
  const dialog = await waitForElement<HTMLDialogElement>(harness.root, "dialog[open]")
  const typed: Record<string, ReturnType<typeof dialogOf>> = { auto: dialogOf(dialog) }
  for (const type of ["text", "number", "boolean", "date", "null"]) {
    enterValue(fieldOf(dialog, "Compare as"), type)
    await nextFrame()
    typed[type] = dialogOf(dialog)
  }
  enterValue(fieldOf(dialog, "Compare as"), "auto")
  enterValue(fieldOf(dialog, "Operator"), "like")
  await nextFrame()
  typed.like = dialogOf(dialog)
  enterValue(fieldOf(dialog, "Operator"), "greaterThan")
  enterValue(fieldOf(dialog, "Value"), "a lot")
  await nextFrame()
  getRole(dialog, "button", { name: "Apply" }).click()
  await vi.waitFor(() => {
    expect(dialog.querySelector('[aria-invalid="true"]')).not.toBeNull()
  })
  typed.wrong = dialogOf(dialog)
  return typed
}

describe("the English words of the definition view", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it.each(Object.keys(STATES) as (keyof typeof STATES)[])(
    "stay what the view said before the blocks: %s",
    async (name) => {
      harness = mountApp()

      expect(await wordingOf(harness, STATES[name])).toEqual(DEFINITION_WORDING[name])
    },
  )

  it("in the variable dialog, for every type and a wrong value", async () => {
    harness = mountApp()

    expect(await dialogWording(harness, DEFINITION_VIEW)).toEqual(DIALOG_WORDING)
  })
})
