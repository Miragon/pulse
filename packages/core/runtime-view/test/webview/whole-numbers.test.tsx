import { afterEach, describe, expect, it, vi } from "vitest"
import { colourOfVariable } from "./harness.js"
import {
  editVariable,
  editorError,
  findEditorError,
  openEditor,
  type VariableEditing,
} from "./variable-editing.js"

const RANGE = "-9223372036854775808 to 9223372036854775807"
const FOR_A_NULL_VARIABLE = `Pulse writes no number without a fraction outside ${RANGE}. Write giftNote as text to keep every digit.`
const FOR_AN_INTEGER_VARIABLE = `amount takes a whole number (Integer), and Pulse writes none outside ${RANGE}.`

describe("a whole number beyond 64 bits, typed into the editor of the core's own instance view", () => {
  let editing: VariableEditing

  afterEach(() => {
    editing.harness.unmount()
  })

  it("is refused inline for a variable that holds null, and nothing is sent", async () => {
    editing = await editVariable("giftNote")
    const field = await editing.writeAs("integer")

    await editing.save(field, "9223372036854775808")

    const error = await findEditorError(editing.harness.root)
    expect(error.textContent).toBe(FOR_A_NULL_VARIABLE)
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(field.getAttribute("aria-describedby")).toBe(error.id)
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    await vi.waitFor(() => {
      expect(getComputedStyle(field).borderTopColor).toBe(colourOfVariable("--danger"))
    })
    expect(field.value).toBe("9223372036854775808")
    expect(editing.fixture.effects.confirmWrite).not.toHaveBeenCalled()
    expect(editing.setVariable).not.toHaveBeenCalled()
  })

  it("is refused inline for a whole-number variable, and nothing is sent", async () => {
    editing = await editVariable("amount")
    const { field } = editing

    await editing.save(field, "-9223372036854775809")

    const error = await findEditorError(editing.harness.root)
    expect(error.textContent).toBe(FOR_AN_INTEGER_VARIABLE)
    expect(field.getAttribute("aria-invalid")).toBe("true")
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    expect(editing.fixture.effects.confirmWrite).not.toHaveBeenCalled()
    expect(editing.setVariable).not.toHaveBeenCalled()
  })

  it("moves the focus back and says the reason again when the same reason comes twice", async () => {
    editing = await editVariable("amount")
    const { field, harness } = editing
    await editing.save(field, "-9223372036854775809")
    const first = await findEditorError(harness.root)
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(field)
    })

    await editing.save(field, "9223372036854775808")

    await vi.waitFor(() => {
      expect(editorError(harness.root)).not.toBe(first)
    })
    const second = editorError(harness.root)
    expect(second?.textContent).toBe(FOR_AN_INTEGER_VARIABLE)
    expect(second?.getAttribute("role")).toBe("alert")
    expect(field.getAttribute("aria-describedby")).toBe(second?.id)
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    expect(editing.setVariable).not.toHaveBeenCalled()
  })

  it("keeps every digit when the user writes it as text, as the error says", async () => {
    editing = await editVariable("giftNote")
    await editing.save(await editing.writeAs("integer"), "9223372036854775808")
    await findEditorError(editing.harness.root)

    await editing.save(await editing.writeAs("text"), "9223372036854775808")

    await vi.waitFor(() => {
      expect(openEditor(editing.harness.root)).toBeNull()
    })
    expect(editing.fixture.effects.confirmWrite).toHaveBeenCalledTimes(1)
    expect(editing.setVariable).toHaveBeenCalledWith(
      editing.fixture.world.instanceIds["ORD-1002"],
      {
        name: "giftNote",
        valueJson: '"9223372036854775808"',
      },
    )
  })
})
