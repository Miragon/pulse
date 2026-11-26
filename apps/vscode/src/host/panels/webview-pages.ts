import { currentAppearance, renderWebviewHtml } from "@miragon/modeler-shell/vscode/extension"
import * as vscode from "vscode"
import { THEMES } from "./open-panel.js"

export class WebviewPages {
  constructor(private readonly extensionUri: vscode.Uri) {}

  prepare(panel: vscode.WebviewPanel, title: string): void {
    panel.webview.options = this.options()
    panel.webview.html = this.html(panel, title)
  }

  options(): vscode.WebviewOptions {
    return { enableScripts: true, localResourceRoots: [this.distUri()] }
  }

  html(panel: vscode.WebviewPanel, title: string): string {
    const asset = (file: string) =>
      panel.webview.asWebviewUri(vscode.Uri.joinPath(this.distUri(), file)).toString()
    return renderWebviewHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: asset("webview.js"),
      styleUris: [asset("webview.css")],
      title,
      lang: "en",
      appearance: currentAppearance(vscode, THEMES),
      body: '<div id="pulse"></div>',
    })
  }

  private distUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.extensionUri, "dist")
  }
}
