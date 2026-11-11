import type { ProcessCommands } from "@miragon/pulse-engine-core"
import { expect, vi, type MockInstance } from "vitest"
import { InstancePanel } from "../../src/core/panels/instance-panel.js"
import { panelFixture, type PanelFixture } from "../core/support/panel-fixture.js"
import { buttonNamed, mountApp, nextFrame, waitForElement, type Harness } from "./harness.js"

export interface VariableEditing {
  readonly harness: Harness
  readonly fixture: PanelFixture
  readonly setVariable: MockInstance<ProcessCommands["setVariable"]>
  readonly field: HTMLTextAreaElement
  writeAs(kind: string): Promise<HTMLTextAreaElement>
  save(field: HTMLTextAreaElement, text: string): Promise<void>
}

export async function editVariable(name: string): Promise<VariableEditing> {
  let setVariable: MockInstance<ProcessCommands["setVariable"]> | undefined
  const fixture = panelFixture((runtime) => runtime, {
    writable: true,
    adaptCommands: (commands) => {
      setVariable = vi.spyOn(commands, "setVariable")
      return commands
    },
  })
  const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1002"])
  await panel.handle({ type: "ready" })
  const harness = mountApp()
  harness.publish(fixture.lastState())
  await waitForElement(harness.root, ".incident-card")
  buttonNamed(harness.root, "Variables4").click()
  await waitForElement(harness.root, ".value-cell__edit")
  harness.root.querySelector<HTMLButtonElement>(`[aria-label="Edit ${name}"]`)?.click()
  const field = await waitForElement<HTMLTextAreaElement>(harness.root, ".variable-editor__field")
  return {
    harness,
    fixture,
    setVariable: setVariable!,
    field,
    writeAs: async (kind) => {
      const picker = harness.root.querySelector<HTMLSelectElement>(".variable-editor__kind")
      picker!.value = kind
      picker!.dispatchEvent(new Event("change", { bubbles: true }))
      await nextFrame()
      return harness.root.querySelector<HTMLTextAreaElement>(".variable-editor__field")!
    },
    save: async (target, text) => {
      target.value = text
      target.dispatchEvent(new Event("input", { bubbles: true }))
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
    },
  }
}
