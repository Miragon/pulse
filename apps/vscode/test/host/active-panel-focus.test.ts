import { BpmnProcessId } from "@miragon/pulse-engine-core"
import { describe, expect, test, vi } from "vitest"
import type * as vscode from "vscode"
import { ActivePanelFocus, type PanelFocus } from "../../src/host/panels/active-panel-focus.js"

vi.mock("vscode", () => import("./support/vscode-fake.js"))

const OVERVIEW: PanelFocus = { engineName: "local-operaton" }
const ORDER: PanelFocus = { engineName: "local-operaton", bpmnProcessId: BpmnProcessId("order") }

type StateListener = (event: vscode.WebviewPanelOnDidChangeViewStateEvent) => void

class FakePanel {
  active = true
  private readonly listeners = new Set<StateListener>()

  readonly onDidChangeViewState = (listener: StateListener): { dispose(): void } => {
    this.listeners.add(listener)
    return {
      dispose: () => {
        this.listeners.delete(listener)
      },
    }
  }

  get watched(): boolean {
    return this.listeners.size > 0
  }

  asPanel(): vscode.WebviewPanel {
    return this as unknown as vscode.WebviewPanel
  }

  becomes(active: boolean): void {
    this.active = active
    for (const listener of [...this.listeners]) {
      listener({ webviewPanel: this.asPanel() })
    }
  }
}

function watched() {
  const focus = new ActivePanelFocus()
  const reported: PanelFocus[] = []
  focus.onDidActivate((next) => reported.push(next))
  return { focus, reported }
}

describe("the focus of the active panel", () => {
  test("is reported when a panel opens and whenever it becomes active again", () => {
    const { focus, reported } = watched()
    const order = new FakePanel()

    focus.track(order.asPanel(), ORDER)
    order.becomes(false)
    order.becomes(true)

    expect(reported).toEqual([ORDER, ORDER])
  })

  test("goes back to the panel still active when a late event of another one ends", () => {
    const { focus, reported } = watched()
    const overview = new FakePanel()
    const order = new FakePanel()
    focus.track(overview.asPanel(), OVERVIEW)
    overview.active = false
    focus.track(order.asPanel(), ORDER)

    overview.becomes(true)
    overview.becomes(false)

    expect(reported.at(-1)).toEqual(ORDER)
  })

  test("stays with the last report when the panel that leaves was not the reported one", () => {
    const { focus, reported } = watched()
    const overview = new FakePanel()
    const order = new FakePanel()
    focus.track(overview.asPanel(), OVERVIEW)
    focus.track(order.asPanel(), ORDER)

    overview.becomes(false)

    expect(reported).toEqual([OVERVIEW, ORDER])
  })

  test("reports nothing for a panel without a focus or after it closed", () => {
    const { focus, reported } = watched()
    const instance = new FakePanel()
    const order = new FakePanel()
    focus.track(instance.asPanel(), undefined).dispose()
    focus.track(order.asPanel(), ORDER).dispose()

    instance.becomes(true)
    order.becomes(true)

    expect(reported).toEqual([ORDER])
    expect([instance.watched, order.watched]).toEqual([false, false])
  })
})
