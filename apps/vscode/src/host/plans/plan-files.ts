import type { PlanSource } from "@miragon/pulse-runtime-view/core"
import * as vscode from "vscode"

export class PlanFiles {
  static readonly SUFFIX = ".migration.json"

  static isPlan(file: vscode.Uri): boolean {
    const name = PlanFiles.nameOf(file)
    return name.length > PlanFiles.SUFFIX.length && name.endsWith(PlanFiles.SUFFIX)
  }

  static nameOf(file: vscode.Uri): string {
    return file.path.slice(file.path.lastIndexOf("/") + 1)
  }

  static sourceOf(file: vscode.Uri): PlanSource {
    return {
      fileName: PlanFiles.nameOf(file),
      location: { uri: file.toString(), line: 1 },
      size: async () => (await vscode.workspace.fs.stat(file)).size,
      read: async () => new TextDecoder().decode(await vscode.workspace.fs.readFile(file)),
    }
  }
}
