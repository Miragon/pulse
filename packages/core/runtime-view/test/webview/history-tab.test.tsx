import { afterEach, describe, expect, it, vi } from "vitest"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { findPart, findRole, getRole, mountApp, type Harness } from "./harness.js"

const CUT_NOTE = "Some lists are cut off, so Pulse shows only part of them."

function notes(root: HTMLElement): string[] {
  const region = getRole(root, "region", { name: "Instance details" })
  return [...region.querySelectorAll("p")]
    .map((note) => note.textContent)
    .filter((text) => text === CUT_NOTE)
}

describe("the History tab of an instance", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("lists every element the instance ran through, the open one without an end", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    await findPart(harness.root, "incident-card")
    getRole(harness.root, "tab", { name: /^History/ }).click()
    const table = await findRole(harness.root, "table", { name: "History" })

    const rows = [...table.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell, index) =>
        index === 2 || index === 3 ? cell.textContent !== "—" : cell.textContent,
      ),
    )

    expect(rows).toEqual([
      ["Order received", "Completed", true, true, "4ms"],
      ["Reserve stock", "Completed", true, true, "1m 2s"],
      ["Check credit", "Running", true, false, "—"],
    ])
  })

  it("says that the engine has no history when the path is empty", async () => {
    harness = mountApp()
    harness.publish({ ...FIXTURES.instance, view: { ...FIXTURES.instance.view, path: [] } })
    await findPart(harness.root, "incident-card")
    getRole(harness.root, "tab", { name: /^History/ }).click()

    const empty = await findPart(harness.root, "empty-hint")

    expect(empty.textContent).toBe("The engine has no history for this instance.")
  })

  it("says that some lists are cut off without claiming which of their entries are left out", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    await findPart(harness.root, "incident-card")
    expect(notes(harness.root)).toEqual([])

    harness.publish({ ...FIXTURES.instance, view: { ...FIXTURES.instance.view, truncated: true } })

    await vi.waitFor(() => {
      expect(notes(harness.root)).toEqual([CUT_NOTE])
    })
  })
})
