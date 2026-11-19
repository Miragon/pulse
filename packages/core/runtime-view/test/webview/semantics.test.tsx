import { afterEach, describe, expect, it } from "vitest"
import { FIXTURES, type FixtureName } from "../../dev/webview/fixtures/states.js"
import { CountLabels } from "../../src/webview/format/count-labels.js"
import {
  allParts,
  allRoles,
  getRole,
  mountApp,
  nextFrame,
  part,
  queryPart,
  queryRole,
  waitForElement,
  type Harness,
} from "./harness.js"

describe("the roles and states each screen keeps", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  async function open(name: FixtureName, selector: string): Promise<HTMLElement> {
    harness = mountApp()
    harness.publish(FIXTURES[name])
    const found = await waitForElement<HTMLElement>(harness.root, selector)
    await nextFrame()
    return found
  }

  function all(selector: string): HTMLElement[] {
    return [...harness.root.querySelectorAll<HTMLElement>(selector)]
  }

  it("shows the scope segments as a radiogroup of radios with aria-checked and one tab stop", async () => {
    const group = await open("definition", '[role="radiogroup"]')
    const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')]

    expect(group.getAttribute("aria-label")).toBe("Show instances")
    expect(radios.length).toBeGreaterThan(1)
    expect(radios.map((radio) => radio.tagName)).toEqual(radios.map(() => "BUTTON"))
    expect(radios.filter((radio) => radio.getAttribute("aria-checked") === "true")).toHaveLength(1)
    expect(radios.every((radio) => ["true", "false"].includes(radio.ariaChecked ?? ""))).toBe(true)
    expect(radios.filter((radio) => radio.tabIndex === 0)).toEqual(
      radios.filter((radio) => radio.ariaChecked === "true"),
    )
  })

  it("shows the instance's tabs as a tablist whose selected tab labels a panel without a tab stop", async () => {
    const list = await open("instance", '[role="tablist"]')
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')]
    const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true")
    const panels = all('[role="tabpanel"]')

    expect(list.getAttribute("aria-label")).not.toBeNull()
    expect(tabs.length).toBeGreaterThan(1)
    expect(selected).toHaveLength(1)
    expect(tabs.every((tab) => ["true", "false"].includes(tab.ariaSelected ?? ""))).toBe(true)
    expect(tabs.map((tab) => tab.tabIndex)).toEqual(
      tabs.map((tab) => (tab === selected[0] ? 0 : -1)),
    )
    expect(panels).toHaveLength(1)
    expect(panels[0]?.getAttribute("aria-labelledby")).toBe(selected[0]?.id)
    expect(selected[0]?.getAttribute("aria-controls")).toBe(panels[0]?.id)
    expect(panels[0]?.hasAttribute("tabindex")).toBe(false)
  })

  it("shows the select-all box in the mixed state while only some instances are selected", async () => {
    const box = await open(
      "definition-selecting",
      '[role="checkbox"][aria-label="Select all shown instances"]',
    )

    expect(box.getAttribute("aria-checked")).toBe("mixed")
  })

  it("shows each column grip as a focusable vertical separator with its width in aria-valuenow", async () => {
    await open("definition", '[role="separator"][aria-label^="Resize column"]')
    const grips = all('[role="separator"][aria-label^="Resize column"]')

    expect(grips.length).toBeGreaterThan(1)
    for (const grip of grips) {
      const now = Number(grip.getAttribute("aria-valuenow"))
      expect(grip.getAttribute("aria-orientation")).toBe("vertical")
      expect(grip.tabIndex).toBe(0)
      expect(now).toBeGreaterThan(0)
      expect(now).toBeLessThanOrEqual(Number(grip.getAttribute("aria-valuemax")))
      expect(grip.getAttribute("aria-valuetext")).toBe(`${now} pixels`)
    }
  })

  it("shows the split between diagram and list as a separator with its share in aria-valuenow", async () => {
    await open("definition", '[role="separator"][aria-label^="Resize column"]')
    const split = all('[role="separator"]').filter(
      (separator) => !separator.getAttribute("aria-label")?.startsWith("Resize column"),
    )

    expect(split).toHaveLength(1)
    expect(Number(split[0]?.getAttribute("aria-valuenow"))).toBeGreaterThan(0)
  })

  it("shows a running bulk operation as a progressbar with a value text", async () => {
    const bar = await open("definition-bulk-running", '[role="progressbar"]')

    expect(bar.getAttribute("aria-label")).toBe("Progress of the bulk operation")
    expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThanOrEqual(0)
    expect(bar.getAttribute("aria-valuetext")).toMatch(/^[\d,]+ of [\d,]+ done$/)
  })

  it("announces an informing strip's message as status, its actions outside it", async () => {
    const strip = await open("definition", part("status-strip", { tone: "info" }))

    expect(strip.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(strip.querySelector('[role="status"] button')).toBeNull()
  })

  it("announces a danger strip's message as alert", async () => {
    const strip = await open("instance-failed-again", part("status-strip", { tone: "danger" }))

    expect(strip.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(strip.querySelector('[role="alert"]')?.textContent).toContain("Failed again")
  })

  it("announces the danger box of a failed read without a view as alert", async () => {
    const box = await open("failed-empty", '[data-part="status-box"][data-tone="danger"]')

    expect(box.getAttribute("role")).toBe("alert")
  })

  it("opens the condition dialog as a native modal dialog", async () => {
    const opener = await open("definition-filtered", '[aria-label="Filter by variables"]')
    opener.click()
    const dialog = await waitForElement<HTMLDialogElement>(harness.root, "dialog[open]")

    expect(dialog).toBeInstanceOf(HTMLDialogElement)
    expect(dialog.matches(":modal")).toBe(true)
  })

  it("shows a read-only Camunda 8 process with counts that stopped, no selection and Operate", async () => {
    const group = await open("definition-camunda8", '[role="radiogroup"]')
    const radios = [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
    const counts = allParts(group, "segment-count")

    expect(radios.map((radio) => radio.textContent)).toEqual([
      "Running 10k+",
      "With incident 37",
      "Ended 10k+",
      "All 20k+",
    ])
    expect(counts.map((count) => count.title)).toEqual([
      CountLabels.exact(10000, true),
      "37",
      CountLabels.exact(10000, true),
      CountLabels.exact(20000, true),
    ])
    expect(CountLabels.exact(10000, true)).toMatch(/^≥\s10,000$/u)
    expect(counts.map((count) => count.dataset.tone)).toEqual([
      undefined,
      "danger",
      undefined,
      undefined,
    ])
    expect(all('[role="checkbox"]')).toEqual([])
    expect(getRole(harness.root, "button", { name: "Open in Operate" }).title).toBe(
      "Open Order fulfillment v3 in Operate on shop-c8",
    )
    expect(queryPart(harness.root, "access", { state: "read-only" })?.title).toBe(
      "Read-only. Pulse reads this engine and changes no data on it.",
    )
  })

  it("names a Camunda 8 incident's cause as its worker's error, offers no retry and says what is cut off", async () => {
    const card = await open("instance-camunda8", part("incident-card"))
    const terms = allRoles(card, "term").map((term) => term.textContent)

    expect(terms[0]).toBe("Worker error")
    expect(terms).not.toContain("Message")
    expect(queryRole(card, "button", { name: /^Retry/ })).toBeNull()
    expect(getRole(card, "button", { name: "Error message" })).toBeDefined()
    expect(
      all("p").filter(
        (note) => note.textContent === "Some lists are cut off, so Pulse shows only part of them.",
      ),
    ).toHaveLength(1)
  })

  it.each<FixtureName>([
    "definition",
    "engine",
    "migration",
    "board",
    "board-refused",
    "board-process",
    "instance",
  ])("gives no two regions of %s the same name", async (name) => {
    await open(name, "main, [data-part]")
    const names = all('section[aria-label], section[aria-labelledby], [role="region"]').map(
      (region) =>
        region.getAttribute("aria-label") ??
        document.getElementById(region.getAttribute("aria-labelledby") ?? "")?.textContent,
    )

    expect(names.length).toBeGreaterThan(0)
    expect(new Set(names).size).toBe(names.length)
  })
})
