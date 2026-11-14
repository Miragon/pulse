import { afterEach, describe, expect, it } from "vitest"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import { findPart, findRole, getRole, mountApp, type Harness } from "./harness.js"

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
})
