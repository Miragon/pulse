import type { IncidentDetails } from "../../contract/index.js"
import * as vscode from "vscode"
import { RootCause } from "../../core/index.js"

export const INCIDENT_SCHEME = "pulse-incident"

export class IncidentDocuments implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>()

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? ""
  }

  async show(title: string, details: IncidentDetails): Promise<void> {
    const extension = details.kind === "stacktrace" ? "log" : "txt"
    const uri = vscode.Uri.from({ scheme: INCIDENT_SCHEME, path: `/${title}.${extension}` })
    this.contents.set(uri.toString(), details.text)
    const document = await vscode.workspace.openTextDocument(uri)
    const causeLine = new vscode.Position(RootCause.lineIndex(details.text) ?? 0, 0)
    await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
      selection: new vscode.Range(causeLine, causeLine),
    })
  }
}
