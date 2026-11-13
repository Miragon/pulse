import { afterEach, describe, expect, it, vi } from "vitest"
import type { WebviewIntent } from "../../src/core/protocol/index.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import {
  buttonNamed,
  enterValue,
  type Harness,
  mountApp,
  nextFrame,
  press,
  allParts,
  findRole,
  getRole,
  queryPart,
} from "./harness.js"

describe("the migration screen", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  function posted(type: WebviewIntent["type"]) {
    return harness.posted.filter((intent) => intent.type === type)
  }

  async function open(fixture: keyof typeof FIXTURES, width = 1200): Promise<HTMLTableElement> {
    harness = mountApp({ width })
    harness.publish(FIXTURES[fixture])
    return findRole<HTMLTableElement>(harness.root, "table", { name: "Mapping" })
  }

  function selectOf(table: HTMLTableElement, label: string): HTMLSelectElement {
    const select = table.querySelector<HTMLSelectElement>(`select[aria-label="Map ${label} to"]`)
    if (select === null) {
      throw new Error(`no select for ${label}`)
    }
    return select
  }

  it("shows both versions side by side with the mapping and the summary", async () => {
    const table = await open("migration")

    const diagrams = allParts(harness.root, "migration-diagram")
    expect(diagrams).toHaveLength(2)
    const [first, second] = [...diagrams].map((diagram) => diagram.getBoundingClientRect())
    expect(second!.left).toBeGreaterThan(first!.left)
    expect(table.tBodies[0]!.rows).toHaveLength(6)
    expect(queryPart(harness.root, "migration-summary")?.textContent).toBe(
      "All 6 elements map by id · no problems · checked just now",
    )
  })

  it("stacks the diagrams in a narrow editor group", async () => {
    await open("migration", 700)
    await nextFrame()

    const [first, second] = allParts(harness.root, "migration-diagram").map((diagram) =>
      diagram.getBoundingClientRect(),
    )
    expect(second!.top).toBeGreaterThan(first!.top)
    expect(second!.left).toBe(first!.left)
  })

  it("maps and unmaps through the select of a row, the keyboard path", async () => {
    const table = await open("migration")
    const select = selectOf(table, "Approve order")

    enterValue(select, "")
    enterValue(select, "Activity_ApproveOrder")

    expect(posted("unmapElement")).toEqual([
      { type: "unmapElement", sourceElementId: "Activity_ApproveOrder" },
    ])
    expect(posted("mapElement")).toEqual([
      {
        type: "mapElement",
        sourceElementId: "Activity_ApproveOrder",
        targetElementId: "Activity_ApproveOrder",
      },
    ])
  })

  it("replaces the migrate button with the refusal and offers to leave the instances out", async () => {
    const table = await open("migration-unmapped")

    expect(table.tBodies[0]!.rows[0]!.textContent).toContain("no mapping")
    expect(queryPart(harness.root, "migration-refusal")?.textContent).toBe(
      "3 of 10 wait at Approve order, which has no mapping in v7.",
    )
    expect(() => buttonNamed(harness.root, "Migrate 10 instances…")).toThrow()

    buttonNamed(harness.root, "Leave the 3 out").click()

    expect(posted("leaveOutUnmapped")).toHaveLength(1)
  })

  it("starts the migration only from the button and picks the target from the header", async () => {
    await open("migration")

    buttonNamed(harness.root, "Migrate 10 instances…").click()
    const picker = getRole<HTMLSelectElement>(harness.root, "combobox", {
      name: "Migrate to version",
    })
    enterValue(picker, "order-fulfillment:5:0b7d")

    expect(posted("startMigration")).toHaveLength(1)
    expect(posted("pickMigrationTarget")).toEqual([
      { type: "pickMigrationTarget", definitionId: "order-fulfillment:5:0b7d" },
    ])
    expect(posted("selectVersion")).toEqual([])
  })

  it("zooms only the diagram the keys were pressed in", async () => {
    await open("migration")
    const [source, target] = allParts(harness.root, "migration-diagram")
    const zoomOf = (diagram: HTMLElement) => /\d+\s?%/.exec(diagram.textContent)?.[0]
    await vi.waitFor(() => {
      expect([zoomOf(source!), zoomOf(target!)]).not.toContain("100%")
    })
    await nextFrame()
    const before = [zoomOf(source!), zoomOf(target!)]

    press(source!.querySelector(".cd-shell-canvas")!, "=", { ctrlKey: true, metaKey: true })
    await nextFrame()

    await vi.waitFor(() => {
      expect(zoomOf(source!)).not.toBe(before[0])
    })
    expect(zoomOf(target!)).toBe(before[1])
  })

  it("marks the focused row for every theme and screen reader", async () => {
    const table = await open("migration")

    const focused = table.querySelector("tr[aria-current]")
    expect(focused?.getAttribute("aria-current")).toBe("true")
    expect(getComputedStyle(focused!).outlineStyle).toBe("solid")
  })

  it("announces why the button is gone and keeps the whole reason in its tooltip", async () => {
    await open("migration-unmapped")

    const live = getRole(harness.root, "group", { name: "Migration" }).querySelector(
      '[aria-live="polite"]',
    )
    expect(live?.textContent).toBe("3 of 10 wait at Approve order, which has no mapping in v7.")
    expect(queryPart(harness.root, "migration-refusal")?.getAttribute("title")).toBe(
      "3 of 10 wait at Approve order, which has no mapping in v7.",
    )
    expect(queryPart(harness.root, "migration-summary")?.getAttribute("aria-live")).toBeNull()
  })

  it("shows the shared bulk strip while the run goes on", async () => {
    await open("migration-running")

    expect(queryPart(harness.root, "bulk-strip")?.textContent).toContain(
      "Migrating instances: 4 of 10 done",
    )
    expect(queryPart(harness.root, "migration-refusal")?.textContent).toBe(
      "Wait until migrating 10 instances ends.",
    )
  })
})

describe("the selection bar", () => {
  it("opens a migration for the selection", async () => {
    const harness = mountApp()
    harness.publish(FIXTURES["definition-selecting"])
    await findRole(harness.root, "group", { name: "Selected instances" })

    buttonNamed(harness.root, "Migrate to version…").click()

    expect(harness.posted.filter((intent) => intent.type === "openMigration")).toEqual([
      { type: "openMigration" },
    ])
    harness.unmount()
  })
})
