import { afterEach, describe, expect, it } from "vitest"
import { FIXTURES } from "../../dev/webview/fixtures/states.js"
import {
  buttonNamed,
  findPart,
  findRole,
  getRole,
  mountApp,
  queryRole,
  type Harness,
} from "./harness.js"

describe("a variable's copy button on an instance no one edits", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it("stays named and in the tab order at rest, beside a short value with no other control", async () => {
    harness = mountApp()
    harness.publish(FIXTURES.instance)
    await findPart(harness.root, "incident-card")
    buttonNamed(harness.root, "Variables6").click()

    const copy = await findRole<HTMLButtonElement>(harness.root, "button", {
      name: "Copy value of orderId",
    })
    const row = copy.closest("tr")
    copy.focus()

    expect(queryRole(harness.root, "button", { name: "Edit orderId" })).toBeNull()
    expect(row?.querySelectorAll("button")).toHaveLength(1)
    expect(getComputedStyle(copy).visibility).toBe("visible")
    expect(document.activeElement).toBe(copy)
    expect(getRole(harness.root, "button", { name: "Copy value of orderId" })).toBe(copy)
  })
})
