import type { ProcessCommands } from "@miragon/pulse-engine-core"
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { InstancePanel } from "../../src/core/panels/instance-panel.js"
import { panelFixture, type PanelFixture } from "../core/support/panel-fixture.js"
import {
  buttonNamed,
  colourOfVariable,
  mountApp,
  nextFrame,
  waitForElement,
  type Harness,
} from "./harness.js"

const RANGE = "-9223372036854775808 to 9223372036854775807"
const FOR_A_NULL_VARIABLE = `Pulse writes no number without a fraction outside ${RANGE}. Write giftNote as text to keep every digit.`
const FOR_AN_INTEGER_VARIABLE = `amount takes a whole number (Integer), and Pulse writes none outside ${RANGE}.`

describe("a whole number beyond 64 bits, typed into the editor of the core's own instance view", () => {
  let harness: Harness
  let fixture: PanelFixture
  let panel: InstancePanel
  let setVariable: MockInstance<ProcessCommands["setVariable"]>

  afterEach(() => {
    harness.unmount()
  })

  async function openEditor(name: string): Promise<HTMLTextAreaElement> {
    fixture = panelFixture((runtime) => runtime, {
      writable: true,
      adaptCommands: (commands) => {
        setVariable = vi.spyOn(commands, "setVariable")
        return commands
      },
    })
    panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1002"])
    await panel.handle({ type: "ready" })
    harness = mountApp()
    harness.publish(fixture.lastState())
    await waitForElement(harness.root, ".incident-card")
    buttonNamed(harness.root, "Variables4").click()
    await waitForElement(harness.root, ".value-cell__edit")
    harness.root.querySelector<HTMLButtonElement>(`[aria-label="Edit ${name}"]`)?.click()
    return waitForElement<HTMLTextAreaElement>(harness.root, ".variable-editor__field")
  }

  async function writeAs(kind: string): Promise<HTMLTextAreaElement> {
    const picker = harness.root.querySelector<HTMLSelectElement>(".variable-editor__kind")
    picker!.value = kind
    picker!.dispatchEvent(new Event("change", { bubbles: true }))
    await nextFrame()
    return harness.root.querySelector<HTMLTextAreaElement>(".variable-editor__field")!
  }

  async function save(field: HTMLTextAreaElement, text: string): Promise<void> {
    field.value = text
    field.dispatchEvent(new Event("input", { bubbles: true }))
    await nextFrame()
    const button = buttonNamed(harness.root, "Save")
    button.focus()
    button.click()
    expect(document.activeElement).toBe(button)
    for (const intent of harness.posted.splice(0)) {
      if (intent.type === "setVariable") {
        await panel.handle(intent)
      }
    }
    harness.publish(fixture.lastState())
  }

  it("is refused inline for a variable that holds null, and nothing is sent", async () => {
    await openEditor("giftNote")
    const field = await writeAs("integer")

    await save(field, "9223372036854775808")

    const error = await waitForElement(harness.root, ".variable-editor__error")
    expect(error.textContent).toBe(FOR_A_NULL_VARIABLE)
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(field.getAttribute("aria-describedby")).toBe(error.id)
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    expect(getComputedStyle(field).borderTopColor).toBe(colourOfVariable("--cd-ui-danger"))
    expect(field.value).toBe("9223372036854775808")
    expect(fixture.effects.confirmWrite).not.toHaveBeenCalled()
    expect(setVariable).not.toHaveBeenCalled()
  })

  it("is refused inline for a whole-number variable, and nothing is sent", async () => {
    const field = await openEditor("amount")

    await save(field, "-9223372036854775809")

    const error = await waitForElement(harness.root, ".variable-editor__error")
    expect(error.textContent).toBe(FOR_AN_INTEGER_VARIABLE)
    expect(field.getAttribute("aria-invalid")).toBe("true")
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    expect(fixture.effects.confirmWrite).not.toHaveBeenCalled()
    expect(setVariable).not.toHaveBeenCalled()
  })

  it("moves the focus back and says the reason again when the same reason comes twice", async () => {
    const field = await openEditor("amount")
    await save(field, "-9223372036854775809")
    const first = await waitForElement(harness.root, ".variable-editor__error")
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(field)
    })

    await save(field, "9223372036854775808")

    await vi.waitFor(() => {
      expect(harness.root.querySelector(".variable-editor__error")).not.toBe(first)
    })
    const second = harness.root.querySelector(".variable-editor__error")
    expect(second?.textContent).toBe(FOR_AN_INTEGER_VARIABLE)
    expect(second?.getAttribute("role")).toBe("alert")
    expect(field.getAttribute("aria-describedby")).toBe(second?.id)
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(field)
    })
    expect(setVariable).not.toHaveBeenCalled()
  })

  it("keeps every digit when the user writes it as text, as the error says", async () => {
    await openEditor("giftNote")
    await save(await writeAs("integer"), "9223372036854775808")
    await waitForElement(harness.root, ".variable-editor__error")

    await save(await writeAs("text"), "9223372036854775808")

    await vi.waitFor(() => {
      expect(harness.root.querySelector(".variable-editor")).toBeNull()
    })
    expect(fixture.effects.confirmWrite).toHaveBeenCalledTimes(1)
    expect(setVariable).toHaveBeenCalledWith(fixture.world.instanceIds["ORD-1002"], {
      name: "giftNote",
      valueJson: '"9223372036854775808"',
    })
  })
})
