import * as vscode from "vscode"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import { TargetsFile } from "../connections/targets-file.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"

export class OpenTargetsFileCommand implements Command {
  readonly id = COMMAND.openTargetsFile

  constructor(private readonly registry: ConnectionRegistry) {}

  async run(path?: unknown): Promise<void> {
    const known = this.knownFile(path)
    if (known !== undefined) {
      await vscode.window.showTextDocument(vscode.Uri.file(known))
      return
    }
    const folder = vscode.workspace.workspaceFolders?.[0]
    if (folder === undefined) {
      void vscode.window.showInformationMessage(
        "Open a folder to configure engines in a .pulse-cli.json.",
      )
      return
    }
    await vscode.window.showTextDocument(await this.projectFileIn(folder.uri))
  }

  private knownFile(path: unknown): string | undefined {
    const broken = this.registry.configurationProblems().map((problem) => problem.path)
    const read = this.registry
      .all()
      .flatMap(({ target }) => (target.source.kind === "file" ? [target.source.path] : []))
    return [...broken, ...read].find((known) => known === path) ?? read[0] ?? broken[0]
  }

  private async projectFileIn(folder: vscode.Uri): Promise<vscode.Uri> {
    const current = TargetsFile.in(folder)
    if (await this.exists(current)) {
      return current
    }
    await vscode.workspace.fs.writeFile(current, new TextEncoder().encode(TargetsFile.TEMPLATE))
    return current
  }

  private exists(file: vscode.Uri): Thenable<boolean> {
    return vscode.workspace.fs.stat(file).then(
      () => true,
      () => false,
    )
  }
}
