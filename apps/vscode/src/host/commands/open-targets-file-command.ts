import * as vscode from "vscode"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import { TargetsFile } from "../connections/targets-file.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"

export class OpenTargetsFileCommand implements Command {
  readonly id = COMMAND.openTargetsFile

  constructor(private readonly registry: ConnectionRegistry) {}

  async run(path?: unknown): Promise<void> {
    const broken = this.registry.configurationProblems().find((problem) => problem.path === path)
    if (broken !== undefined) {
      await vscode.window.showTextDocument(vscode.Uri.file(broken.path))
      return
    }
    const fromFile = this.registry
      .all()
      .find((connection) => connection.target.source.kind === "file")
    if (fromFile?.target.source.kind === "file") {
      await vscode.window.showTextDocument(vscode.Uri.file(fromFile.target.source.path))
      return
    }
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (folder === undefined) {
      void vscode.window.showInformationMessage(
        "Open a folder to configure engines in a .operate.json.",
      )
      return
    }
    const file = TargetsFile.in(folder.uri)
    if (!(await this.exists(file))) {
      await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(TargetsFile.TEMPLATE))
    }
    await vscode.window.showTextDocument(file)
  }

  private exists(file: vscode.Uri): Thenable<boolean> {
    return vscode.workspace.fs.stat(file).then(
      () => true,
      () => false,
    )
  }
}
