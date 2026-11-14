import type { ProcessCommands, VariableChange } from "@miragon/pulse-engine-core"
import { expect, vi, type MockInstance } from "vitest"
import { InstancePanel } from "../../src/core/panels/instance-panel.js"
import { panelFixture, type PanelFixture } from "../core/support/panel-fixture.js"
import {
  buttonNamed,
  enterValue,
  type Harness,
  mountApp,
  findPart,
  findRole,
  getRole,
  nextFrame,
  queryRole,
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
  await findPart(harness.root, "incident-card")
  buttonNamed(harness.root, `Variables${VARIABLES_OF_THE_INSTANCE + addedVariables.length}`).click()
  ;(await findRole(harness.root, "button", { name: `Edit ${name}` })).click()
  const field = await findRole<HTMLTextAreaElement>(harness.root, "textbox", { name: "New value" })
  return {
    harness,
    fixture,
    setVariable,
    field,
    writeAs: async (kind) => {
      enterValue(getRole<HTMLSelectElement>(harness.root, "combobox", { name: "Write as" }), kind)
      await nextFrame()
      return getRole<HTMLTextAreaElement>(harness.root, "textbox", { name: "New value" })
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

export function openEditor(root: HTMLElement): HTMLElement | null {
  return queryRole(root, "group", { name: /^Edit / })
}

export function editorError(root: HTMLElement): HTMLElement | null {
  const editor = openEditor(root)
  return editor === null ? null : queryRole(editor, "alert")
}

export function findEditorError(root: HTMLElement): Promise<HTMLElement> {
  return vi.waitFor(() => getRole(getRole(root, "group", { name: /^Edit / }), "alert"), {
    timeout: 5000,
    interval: 25,
  })
}
