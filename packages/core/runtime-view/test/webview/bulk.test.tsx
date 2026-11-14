import { afterEach, describe, expect, it } from "vitest"
import type { WebviewIntent } from "../../src/core/protocol/index.js"
import { INSTANCES } from "../../dev/webview/fixtures/definition.js"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import {
  buttonNamed,
  findPart,
  findRole,
  getRole,
  mountApp,
  nextFrame,
  press,
  queryPart,
  queryRole,
  type Harness,
} from "./harness.js"

describe("bulk operations on the definition screen", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  function posted(type: WebviewIntent["type"]) {
    return harness.posted.filter((intent) => intent.type === type)
  }

  async function open(fixture: keyof typeof FIXTURES): Promise<HTMLTableElement> {
    harness = mountApp()
    harness.publish(FIXTURES[fixture])
    return findRole<HTMLTableElement>(harness.root, "table", { name: "Instances" })
  }

  function rowOf(table: HTMLTableElement, businessKey: string): HTMLTableRowElement {
    const row = [...table.tBodies[0]!.rows].find((candidate) =>
      candidate.textContent.includes(businessKey),
    )
    if (row === undefined) {
      throw new Error(`no row for ${businessKey}`)
    }
    return row
  }

  it("shows no selection column on a read-only engine", async () => {
    const table = await open("definition")

    expect(queryRole(table, "checkbox", { name: "Select all shown instances" })).toBeNull()
    expect(queryRole(harness.root, "group", { name: "Selected instances" })).toBeNull()
  })

  it("toggles one instance with its checkbox without opening it", async () => {
    const table = await open("definition-selecting")
    const box = getRole<HTMLButtonElement>(rowOf(table, "ORD-10440"), "checkbox")

    expect(box.getAttribute("aria-label")).toBe("Select ORD-10440")
    expect(box.tabIndex).toBe(-1)
    box.click()

    expect(posted("toggleInstances")).toEqual([
      { type: "toggleInstances", ids: [INSTANCES[1]!.id], selected: true },
    ])
    expect(posted("openInstance")).toEqual([])
  })

  it("toggles the focused row with Space and still opens it with Enter", async () => {
    const table = await open("definition-selecting")
    const row = rowOf(table, "ORD-10442")

    press(row, " ")
    press(row, "Enter")

    expect(posted("toggleInstances")).toEqual([
      { type: "toggleInstances", ids: [INSTANCES[0]!.id], selected: false },
    ])
    expect(posted("openInstance")).toHaveLength(1)
  })

  it("selects every shown instance from the header box, which shows a partial selection", async () => {
    const table = await open("definition-selecting")
    const header = getRole<HTMLButtonElement>(table.tHead!, "checkbox", {
      name: "Select all shown instances",
    })

    expect(header.getAttribute("aria-checked")).toBe("mixed")
    header.click()

    expect(posted("toggleInstances")).toEqual([
      { type: "toggleInstances", ids: INSTANCES.map((row) => row.id), selected: true },
    ])
  })

  it("toggles a row from anywhere in its checkbox cell", async () => {
    const table = await open("definition-selecting")
    const cell = getRole(rowOf(table, "ORD-10440"), "checkbox").closest("label")!

    cell.click()

    expect(posted("toggleInstances")).toHaveLength(1)
    expect(posted("openInstance")).toEqual([])
  })

  it("clears instead of unticking the shown rows when more are selected than shown", async () => {
    harness = mountApp()
    const selecting = FIXTURES["definition-selecting"]
    harness.publish({
      ...selecting,
      view: {
        ...selecting.view,
        instances: selecting.view.instances.map((row) => ({ ...row, selected: true as const })),
        selection: { ...selecting.view.selection!, count: 120, allMatching: true },
      },
    })
    const table = await findRole<HTMLTableElement>(harness.root, "table", { name: "Instances" })

    getRole(table.tHead!, "checkbox").click()

    expect(posted("clearSelection")).toHaveLength(1)
    expect(posted("toggleInstances")).toEqual([])
  })

  it("clears the selection with Escape from a checkbox too", async () => {
    const table = await open("definition-selecting")

    press(getRole(table.tHead!, "checkbox"), "Escape")

    expect(posted("clearSelection")).toHaveLength(1)
  })

  it("keeps the checkbox column out of the saved column widths", async () => {
    const table = await open("definition-selecting")
    const grip = table.querySelector<HTMLElement>('[aria-label="Resize column ID"]')!

    press(grip, "ArrowRight")
    await nextFrame()

    const stored = (harness.api.getState() as { pulse: { columnWidths: Record<string, object> } })
      .pulse.columnWidths.instances!
    expect(Object.keys(stored).sort()).toEqual(["businessKey", "id", "state"])
    expect(Math.round(table.tHead!.querySelector("th")!.getBoundingClientRect().width)).toBe(32)
  })

  it("offers every matching instance, the bulk action and a way to clear", async () => {
    await open("definition-selecting")
    const bar = await findRole(harness.root, "group", { name: "Selected instances" })

    expect(queryPart(bar, "selection-count")?.textContent).toBe("3 selected")
    buttonNamed(bar, "Select all 12 running").click()
    buttonNamed(bar, "Cancel instances…").click()
    buttonNamed(bar, "Clear").click()

    expect(harness.posted.slice(-3)).toEqual([
      { type: "selectMatching" },
      { type: "startBulk", action: "cancelInstances" },
      { type: "clearSelection" },
    ])
  })

  it("clears the selection with Escape before it clears anything else", async () => {
    await open("definition-selecting")
    const heading = await findRole(harness.root, "heading", { level: 1 })

    press(heading, "Escape")

    expect(posted("clearSelection")).toHaveLength(1)
    expect(posted("filterInstances")).toEqual([])
  })

  it("follows a running operation with a progress bar and a Stop button", async () => {
    await open("definition-bulk-running")
    const strip = await findPart(harness.root, "bulk-strip")
    const bar = getRole(strip, "progressbar", { name: "Progress of the bulk operation" })

    expect(queryPart(strip, "strip-title")?.textContent).toBe("Cancelling instances: 5 of 12 done")
    expect([bar.getAttribute("aria-valuenow"), bar.getAttribute("aria-valuemax")]).toEqual([
      "5",
      "12",
    ])
    buttonNamed(strip, "Stop").click()

    expect(posted("stopBulk")).toHaveLength(1)
  })

  it("offers the instances a stopped operation did not reach, and dismisses it", async () => {
    await open("definition-bulk-stopped")
    const strip = await findPart(harness.root, "bulk-strip")

    expect(queryRole(strip, "progressbar")).toBeNull()
    buttonNamed(strip, "Select the 7 still running").click()
    buttonNamed(strip, "Dismiss").click()

    expect(harness.posted.slice(-2)).toEqual([{ type: "selectRemaining" }, { type: "dismissBulk" }])
  })

  it("announces a change of state, not every count", async () => {
    await open("definition-bulk-running")
    const strip = await findPart(harness.root, "bulk-strip")
    const live = strip.querySelector('[aria-live="polite"]')!
    const running = FIXTURES["definition-bulk-running"]
    const bulk = running.view.bulk!

    harness.publish({
      ...running,
      view: {
        ...running.view,
        bulk: {
          ...bulk,
          announcement: "Cancelling instances: 6 of 12 done",
          notice: { ...bulk.notice, title: "Cancelling instances: 6 of 12 done" },
        },
      },
    })
    await nextFrame()
    expect(live.textContent).toBe("Cancelling instances: 5 of 12 done")

    harness.publish(FIXTURES["definition-bulk-stopped"])
    await nextFrame()
    expect(
      queryPart(harness.root, "bulk-strip")?.querySelector('[aria-live="polite"]')?.textContent,
    ).toBe("Stopped. 5 of 12 cancelled, 7 still running.")
  })
})
