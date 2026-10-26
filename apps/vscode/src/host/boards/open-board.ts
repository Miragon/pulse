import { BoardPanel, StatePublisher, type BoardContext } from "../../core/index.js"
import { MessageGuards, type PanelState } from "../../core/protocol/index.js"
import { connectThemeBridge } from "@miragon/modeler-shell/vscode/extension"
import * as vscode from "vscode"
import { THEMES } from "../panels/open-panel.js"
import { PanelTitle } from "../panels/panel-title.js"

export type BoardContextFactory = (publish: (state: PanelState) => void) => BoardContext

export class OpenBoard implements vscode.Disposable {
  private readonly session: BoardPanel
  private readonly subscriptions: vscode.Disposable[]

  constructor(
    readonly panel: vscode.WebviewPanel,
    contextFor: BoardContextFactory,
  ) {
    const fallbackTitle = panel.title
    const publisher = new StatePublisher((message) => {
      panel.title = PanelTitle.of(message.state, fallbackTitle)
      void panel.webview.postMessage(message)
    })
    this.session = new BoardPanel(
      contextFor((state) => {
        publisher.publish(state)
      }),
    )
    this.subscriptions = [
      panel.webview.onDidReceiveMessage((message: unknown) => {
        this.receive(message)
      }),
      connectThemeBridge(vscode, panel, THEMES),
    ]
  }

  reload(): void {
    void this.session.handle({ type: "refresh" })
  }

  dispose(): void {
    this.session.dispose()
    for (const subscription of this.subscriptions) {
      subscription.dispose()
    }
  }

  private receive(message: unknown): void {
    if (MessageGuards.isWebviewIntent(message) && message.type !== "activity") {
      void this.session.handle(message)
    }
  }
}
