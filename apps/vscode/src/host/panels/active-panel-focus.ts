import type { BpmnProcessId } from "@miragon/pulse-engine-core"
import * as vscode from "vscode"

export interface PanelFocus {
  readonly engineName: string
  readonly bpmnProcessId?: BpmnProcessId
}

export class ActivePanelFocus implements vscode.Disposable {
  private readonly activated = new vscode.EventEmitter<PanelFocus>()
  readonly onDidActivate = this.activated.event
  private readonly focuses = new Map<vscode.WebviewPanel, PanelFocus>()
  private reported: vscode.WebviewPanel | undefined

  track(panel: vscode.WebviewPanel, focus: PanelFocus | undefined): vscode.Disposable {
    if (focus === undefined) {
      return { dispose: () => undefined }
    }
    this.focuses.set(panel, focus)
    this.report(panel)
    const listener = panel.onDidChangeViewState((event) => {
      this.changed(event.webviewPanel)
    })
    return {
      dispose: () => {
        listener.dispose()
        this.forget(panel)
      },
    }
  }

  dispose(): void {
    this.activated.dispose()
    this.focuses.clear()
  }

  private changed(panel: vscode.WebviewPanel): void {
    if (panel.active) {
      this.report(panel)
      return
    }
    if (panel !== this.reported) {
      return
    }
    const other = [...this.focuses.keys()].find(
      (candidate) => candidate !== panel && candidate.active,
    )
    if (other !== undefined) {
      this.report(other)
    }
  }

  private report(panel: vscode.WebviewPanel): void {
    const focus = this.focuses.get(panel)
    if (focus !== undefined) {
      this.reported = panel
      this.activated.fire(focus)
    }
  }

  private forget(panel: vscode.WebviewPanel): void {
    this.focuses.delete(panel)
    if (this.reported === panel) {
      this.reported = undefined
    }
  }
}
