import type { PlanSource } from "@miragon/pulse-runtime-view/core"
import * as vscode from "vscode"

export class PlanFiles {
  static readonly SUFFIX = ".migration.json"

  static isPlan(file: vscode.Uri): boolean {
    const name = PlanFiles.nameOf(file)
    return name.length > PlanFiles.SUFFIX.length && name.endsWith(PlanFiles.SUFFIX)
  }

  static keyOf(file: vscode.Uri): string {
    return `plan|${file.toString()}|`
  }

  static nameOf(file: vscode.Uri): string {
    return file.path.slice(file.path.lastIndexOf("/") + 1)
  }

  static sourceOf(document: vscode.TextDocument): PlanSource {
    return {
      fileName: PlanFiles.nameOf(document.uri),
      location: { uri: document.uri.toString(), line: 1, beside: true },
      size: () => Promise.resolve(document.getText().length),
      read: () => Promise.resolve(document.getText()),
      write: (text) => PlanFiles.replace(document, text),
    }
  }

  private static async replace(document: vscode.TextDocument, text: string): Promise<boolean> {
    const shown = document.getText()
    if (shown === text) {
      return true
    }
    const edit = new vscode.WorkspaceEdit()
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(0), document.positionAt(shown.length)),
      text,
    )
    return vscode.workspace.applyEdit(edit)
  }
}
