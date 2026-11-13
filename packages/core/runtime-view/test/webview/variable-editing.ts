import type { ProcessCommands, VariableChange } from "@miragon/pulse-engine-core"
import { expect, vi, type MockInstance } from "vitest"
import { InstancePanel } from "../../src/core/panels/instance-panel.js"
import { panelFixture, type PanelFixture } from "../core/support/panel-fixture.js"
import {
  buttonNamed,
  enterValue,
  type Harness,
  mountApp,
  nextFrame,
  waitForElement,
} from "./harness.js"

const VARIABLES_OF_THE_INSTANCE = 4

export interface VariableEditing {
  readonly harness: Harness
  readonly fixture: PanelFixture
  readonly setVariable: MockInstance<ProcessCommands["setVariable"]>
  readonly field: HTMLTextAreaElement
  writeAs(kind: string): Promise<HTMLTextAreaElement>
  save(field: HTMLTextAreaElement, text: string): Promise<void>
}

export async function editVariable(
  name: string,
  addedVariables: readonly VariableChange[] = [],
): Promise<VariableEditing> {
  let engine: ProcessCommands | undefined
  const fixture = panelFixture((runtime) => runtime, {
    writable: true,
    adaptCommands: (commands) => {
      engine = commands
      return commands
    },
  })
  const instanceId = fixture.world.instanceIds["ORD-1002"]
  for (const change of addedVariables) {
    await engine!.setVariable(instanceId, change)
  }
  const setVariable = vi.spyOn(engine!, "setVariable")
  const panel = new InstancePanel(fixture.context, instanceId)
  await panel.handle({ type: "ready" })
  const harness = mountApp()
  harness.publish(fixture.lastState())
  await waitForElement(harness.root, ".incident-card")
  buttonNamed(harness.root, `Variables${VARIABLES_OF_THE_INSTANCE + addedVariables.length}`).click()
  await waitForElement(harness.root, ".value-cell__edit")
  harness.root.querySelector<HTMLButtonElement>(`[aria-label="Edit ${name}"]`)?.click()
  const field = await waitForElement<HTMLTextAreaElement>(harness.root, ".variable-editor__field")
  return {
    harness,
    fixture,
    setVariable,
    field,
    writeAs: async (kind) => {
      const picker = harness.root.querySelector<HTMLSelectElement>(".variable-editor__kind")
      enterValue(picker, kind)
      await nextFrame()
      return harness.root.querySelector<HTMLTextAreaElement>(".variable-editor__field")!
    },
    save: async (target, text) => {
      enterValue(target, text)
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
