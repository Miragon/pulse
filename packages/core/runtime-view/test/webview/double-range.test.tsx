import { afterEach, describe, expect, it, vi } from "vitest"
import { colourOfVariable } from "./harness.js"
import {
  editVariable,
  findEditorError,
  openEditor,
  type VariableEditing,
} from "./variable-editing.js"

const RANGE = "-1.7976931348623157e308 to 1.7976931348623157e308"
const FOR_A_NULL_VARIABLE = `Pulse writes no number outside ${RANGE}, the range of a double. Write giftNote as text to keep it as written.`
const FOR_A_DOUBLE_VARIABLE = `ratio takes a number (Double), and Pulse writes none outside ${RANGE}.`
const BEYOND_A_DOUBLE = `${"9".repeat(400)}.5`

describe("a number beyond the range of a double, typed into the editor of the core's own instance view", () => {
  let editing: VariableEditing

  afterEach(() => {
    editing.harness.unmount()
  })

  async function refusedInline(field: HTMLTextAreaElement, reason: string): Promise<void> {
    const error = await findEditorError(editing.harness.root)
    expect(error.textContent).toBe(reason)
    expect(error.getAttribute("role")).toBe("alert")
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(field.getAttribute("aria-describedby")).toBe(error.id)
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    await vi.waitFor(() => {
      expect(getComputedStyle(field).borderTopColor).toBe(colourOfVariable("--danger"))
    })
    expect(editing.fixture.effects.confirmWrite).not.toHaveBeenCalled()
    expect(editing.setVariable).not.toHaveBeenCalled()
  }

  it.each([
    ["Number", "decimal"],
    ["Whole number", "integer"],
    ["JSON", "json"],
  ])(
    "is refused inline for a variable that holds null, written as %s, and nothing is sent",
    async (_label, kind) => {
      editing = await editVariable("giftNote")
      const field = await editing.writeAs(kind)

      await editing.save(field, "1e400")

      await refusedInline(field, FOR_A_NULL_VARIABLE)
      expect(field.value).toBe("1e400")
    },
  )

  it("is refused inline for a Double variable, and nothing is sent", async () => {
    editing = await editVariable("ratio", [{ name: "ratio", valueJson: "0.5", type: "Double" }])
    const { field } = editing

    await editing.save(field, BEYOND_A_DOUBLE)

    await refusedInline(field, FOR_A_DOUBLE_VARIABLE)
    expect(field.value).toBe(BEYOND_A_DOUBLE)
  })

  it("keeps the number as written when the user writes it as text, as the error says", async () => {
    editing = await editVariable("giftNote")
    await editing.save(await editing.writeAs("decimal"), BEYOND_A_DOUBLE)
    await findEditorError(editing.harness.root)

    await editing.save(await editing.writeAs("text"), BEYOND_A_DOUBLE)

    await vi.waitFor(() => {
      expect(openEditor(editing.harness.root)).toBeNull()
    })
    expect(editing.fixture.effects.confirmWrite).toHaveBeenCalledTimes(1)
    expect(editing.setVariable).toHaveBeenCalledWith(
      editing.fixture.world.instanceIds["ORD-1002"],
      {
        name: "giftNote",
        valueJson: JSON.stringify(BEYOND_A_DOUBLE),
      },
    )
  })

  it("writes the largest double for a Double variable", async () => {
    editing = await editVariable("ratio", [{ name: "ratio", valueJson: "0.5", type: "Double" }])

    await editing.save(editing.field, "1.7976931348623157e308")

    await vi.waitFor(() => {
      expect(openEditor(editing.harness.root)).toBeNull()
    })
    expect(editing.fixture.effects.confirmWrite.mock.calls[0]?.[0].facts).toContain(
      "Double: 0.5 → 1.7976931348623157e308",
    )
    expect(editing.setVariable).toHaveBeenCalledWith(
      editing.fixture.world.instanceIds["ORD-1002"],
      {
        name: "ratio",
        valueJson: "1.7976931348623157e308",
        type: "Double",
      },
    )
  })
})
