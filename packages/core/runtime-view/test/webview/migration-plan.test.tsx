import { afterEach, describe, expect, it } from "vitest"
import { userEvent } from "vitest/browser"
import type { MigrationPlanView, WebviewIntent } from "../../src/core/protocol/index.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import {
  allParts,
  allRoles,
  buttonNamed,
  findRole,
  getRole,
  mountApp,
  part,
  queryPart,
  queryRole,
  waitForElement,
  type Harness,
} from "./harness.js"

const PLAN = FIXTURES["migration-plan"].view
const BLOCKED = FIXTURES["migration-plan-blocked"].view

function hitOf(diagram: Element, elementId: string): Promise<SVGElement> {
  return waitForElement<SVGElement>(
    diagram,
    `g.djs-element[data-element-id="${elementId}"] .djs-hit`,
  )
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }))
}

describe("the migration plan preview", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  function posted(type: WebviewIntent["type"]) {
    return harness.posted.filter((intent) => intent.type === type)
  }

  async function open(view: MigrationPlanView): Promise<HTMLTableElement> {
    harness = mountApp()
    harness.publish({ status: "ready", view, refreshing: false })
    return findRole<HTMLTableElement>(harness.root, "table", { name: "Mapping" })
  }

  function rowOf(table: HTMLTableElement, label: string): HTMLTableRowElement {
    const row = [...table.tBodies[0]!.rows].find((candidate) =>
      candidate.cells[0]?.textContent.startsWith(label),
    )
    if (row === undefined) {
      throw new Error(`no row for ${label}`)
    }
    return row
  }

  it("shows both versions, the file's mapping with its tokens and the verdict, and offers no migration", async () => {
    const table = await open(PLAN)

    expect(allParts(harness.root, "migration-diagram")).toHaveLength(2)
    expect(allRoles(table, "columnheader").map((head) => head.textContent)).toEqual([
      "In v6",
      "In v7",
      "Tokens",
      "Check",
    ])
    expect(table.tBodies[0]!.rows).toHaveLength(6)
    expect([...rowOf(table, "Check credit").cells].map((cell) => cell.textContent)).toEqual([
      "Check credit",
      "Check credit",
      "5",
      "—",
    ])
    expect(allRoles(harness.root, "combobox")).toEqual([])
    expect(
      allRoles(harness.root, "button").filter((button) => /migrate/i.test(button.textContent)),
    ).toEqual([])
    expect(queryPart(harness.root, "migration-summary")?.textContent).toBe(
      "6 mapped · no problems · checked just now",
    )
    expect(queryPart(harness.root, "plan-verdict")?.textContent).toBe(PLAN.verdict.text)
  })

  it("names the two versions, the running instances and the engine in the bar", async () => {
    await open(PLAN)
    const bar = queryPart(harness.root, "context-bar")!

    expect(bar.getAttribute("data-kind")).toBe("migration")
    expect(getRole(bar, "heading", { level: 1 }).textContent).toBe("Order fulfillment")
    expect(bar.textContent).toContain("v6 to v7")
    expect(queryPart(bar, "context-key")?.textContent).toBe("12 running · 2 with incident")
  })

  it("opens each version, shows the file and reads both again from the bar", async () => {
    await open(PLAN)

    buttonNamed(harness.root, "Open v6").click()
    buttonNamed(harness.root, "Open v7").click()
    buttonNamed(harness.root, "Show file").click()
    buttonNamed(harness.root, "Refresh").click()

    expect(posted("openDefinition")).toEqual([
      {
        type: "openDefinition",
        bpmnProcessId: "order-fulfillment",
        definitionId: "order-fulfillment:6:91e0",
      },
      {
        type: "openDefinition",
        bpmnProcessId: "order-fulfillment",
        definitionId: "order-fulfillment:7:4a1c",
      },
    ])
    expect(posted("openPlanFile")).toEqual([{ type: "openPlanFile" }])
    expect(posted("refresh")).toEqual([{ type: "refresh" }])
  })

  it("focuses a mapping through its source button, by click and by keyboard, and marks its row", async () => {
    const table = await open(PLAN)
    const reserve = getRole<HTMLButtonElement>(table, "button", { name: "Reserve stock" })

    reserve.click()
    getRole<HTMLButtonElement>(table, "button", { name: "Ship order" }).focus()
    await userEvent.keyboard("{Enter}")

    expect(reserve.type).toBe("button")
    expect(posted("focusMapping")).toEqual([
      { type: "focusMapping", sourceElementId: "Activity_ReserveStock" },
      { type: "focusMapping", sourceElementId: "Activity_ShipOrder" },
    ])
    expect(table.querySelectorAll("tr[aria-current]")).toHaveLength(1)
    expect(rowOf(table, "Check credit").getAttribute("aria-current")).toBe("true")
    expect(getComputedStyle(rowOf(table, "Check credit")).outlineStyle).toBe("solid")
  })

  it("focuses a mapping from the diagram to migrate from, and maps nothing from the one to migrate to", async () => {
    await open(PLAN)
    const [source, target] = allParts(harness.root, "migration-diagram")

    click(await hitOf(target!, "Activity_ApproveOrder"))
    click(await hitOf(source!, "Activity_ApproveOrder"))

    expect(posted("focusMapping")).toEqual([
      { type: "focusMapping", sourceElementId: "Activity_ApproveOrder" },
    ])
    expect(posted("mapElement")).toEqual([])
    expect(posted("unmapElement")).toEqual([])
  })

  it("lists the left-out pair and the engine's problem first, each named as the danger it is", async () => {
    const table = await open(BLOCKED)
    const rows = [...table.tBodies[0]!.rows]

    expect(rows.map((row) => row.cells[0]?.textContent)).toEqual([
      "Ship order",
      "Check credit",
      "Approve orderno mapping",
      "Reserve stock",
      "Wait for pickup",
      "Payment received",
    ])
    const refused = rowOf(table, "Ship order")
    expect(refused.cells[1]?.textContent).toBe("Activity_ShipParcel")
    expect(queryPart(refused, "mapping-note", { tone: "danger" })?.textContent).toBe(
      "v7 has no element Activity_ShipParcel.",
    )
    expect(queryPart(rowOf(table, "Check credit"), "mapping-note")?.dataset.tone).toBe("danger")
    const unmapped = rowOf(table, "Approve order")
    expect([...unmapped.cells].map((cell) => cell.textContent)).toEqual([
      "Approve orderno mapping",
      "Not mapped",
      "3",
      "—",
    ])
    expect(rowOf(table, "Wait for pickup").cells[2]?.textContent).toBe("—")
  })

  it("ties each check note to its source button", async () => {
    const table = await open(BLOCKED)
    const button = getRole(table, "button", { name: "Ship order" })
    const note = queryPart(rowOf(table, "Ship order"), "mapping-note")!

    expect(button.getAttribute("aria-describedby")).toBe(note.id)
    expect(
      getRole(table, "button", { name: "Reserve stock" }).getAttribute("aria-describedby"),
    ).toBeNull()
  })

  it("shows a warning of a row in its own tone", async () => {
    const table = await open({
      ...PLAN,
      rows: [
        {
          ...PLAN.rows[0]!,
          warning: "The timer Wait for pickup at Reserve stock starts again.",
        },
        ...PLAN.rows.slice(1),
      ],
    })

    expect(queryPart(table, "mapping-note")?.dataset.tone).toBe("warning")
    expect(queryPart(table, "mapping-note")?.textContent).toBe(
      "The timer Wait for pickup at Reserve stock starts again.",
    )
  })

  it("says the verdict in a polite live region, with the danger icon only when the plan does not fit", async () => {
    await open(BLOCKED)
    const verdict = queryPart(harness.root, "plan-verdict")!

    expect(verdict.getAttribute("aria-live")).toBe("polite")
    expect(verdict.textContent).toBe(BLOCKED.verdict.text)
    expect(verdict.dataset.tone).toBe("danger")
    expect(verdict.querySelector("svg")).not.toBeNull()

    harness.publish(FIXTURES["migration-plan"])

    await expect
      .poll(() => queryPart(harness.root, "plan-verdict")?.textContent)
      .toBe(PLAN.verdict.text)
    expect(queryPart(harness.root, "plan-verdict")?.querySelector("svg")).toBeNull()
    expect(queryPart(harness.root, "plan-verdict")?.dataset.tone).toBe("neutral")
  })

  it("lists what a migration with this plan does, with no button beside it", async () => {
    await open(BLOCKED)
    const facts = getRole(harness.root, "list", { name: "What a migration with this plan does" })
    const group = getRole(harness.root, "group", { name: "Plan check" })

    expect(allRoles(facts, "listitem").map((item) => item.textContent)).toEqual(BLOCKED.facts)
    expect(allRoles(group, "button")).toEqual([])
    expect(facts.closest(part("plan-facts"))).toBe(facts)
  })

  it("shows the notices as strips above the diagrams", async () => {
    await open(BLOCKED)
    const strips = queryPart(harness.root, "strips")!

    expect(allParts(strips, "strip-title").map((title) => title.textContent)).toEqual(
      BLOCKED.notices.map((notice) => notice.title),
    )
  })

  it("keeps the plan under the problem when the engine cannot be read again", async () => {
    harness = mountApp()
    harness.publish({
      status: "failed",
      problem: {
        title: "Couldn't reach local.",
        detail: "Check that the engine runs.",
        canEditConnection: true,
      },
      engine: PLAN.engine,
      staleView: PLAN,
    })

    await findRole(harness.root, "table", { name: "Mapping" })
    expect(queryPart(harness.root, "strips")?.textContent).toContain("Couldn't reach local.")
    expect(queryPart(harness.root, "freshness")?.dataset.state).toBe("offline")
    expect(queryRole(harness.root, "button", { name: "Show file" })).not.toBeNull()
  })
})

describe("the migration tab's diagrams", () => {
  it("map the focused source onto the element clicked in the diagram to migrate to", async () => {
    const harness = mountApp()
    harness.publish(FIXTURES.migration)
    const [, target] = allParts(harness.root, "migration-diagram")

    click(await hitOf(target!, "Activity_ApproveOrder"))

    expect(harness.posted.filter((intent) => intent.type === "mapElement")).toEqual([
      {
        type: "mapElement",
        sourceElementId: "Activity_CheckCredit",
        targetElementId: "Activity_ApproveOrder",
      },
    ])
    harness.unmount()
  })
})
