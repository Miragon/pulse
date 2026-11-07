import * as vscode from "vscode"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import { TargetsFile } from "../connections/targets-file.js"
import { UserConfigFile } from "../connections/user-config-file.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"
import { ProfileFileChoice, type ProfileHome } from "./profile-file-choice.js"

export class OpenTargetsFileCommand implements Command {
  readonly id = COMMAND.openTargetsFile

  constructor(private readonly registry: ConnectionRegistry) {}

  async run(path?: unknown): Promise<void> {
    const known = this.knownFiles()
    if (typeof path === "string" && known.includes(path)) {
      await vscode.window.showTextDocument(vscode.Uri.file(path))
      return
    }
    const home = await ProfileFileChoice.pick(known)
    if (home !== undefined) {
      await this.open(home)
    }
  }

  private knownFiles(): readonly string[] {
    return [
      ...this.registry
        .all()
        .flatMap(({ target }) => (target.source.kind === "file" ? [target.source.path] : [])),
      ...this.registry.configurationProblems().map((problem) => problem.path),
    ]
  }

  private async open(home: ProfileHome): Promise<void> {
    if (home.scope === "project") {
      await vscode.window.showTextDocument(await this.projectFile(home.file))
      return
    }
    const created = await UserConfigFile.createIfMissing(home.file.fsPath)
    const editor = await vscode.window.showTextDocument(home.file)
    if (created) {
      await editor.insertSnippet(
        this.firstProfile(),
        editor.document.validateRange(new vscode.Range(0, 0, editor.document.lineCount, 0)),
      )
      await this.registry.reload()
    }
  }

  private async projectFile(file: vscode.Uri): Promise<vscode.Uri> {
    if (await this.exists(file)) {
      return file
    }
    await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(TargetsFile.TEMPLATE))
    return file
  }

  private firstProfile(): vscode.SnippetString {
    return new vscode.SnippetString()
      .appendText('{\n  "profiles": {\n    "')
      .appendPlaceholder("dev")
      .appendText('": {\n      "url": "')
      .appendPlaceholder("https://dev.example.com/engine-rest")
      .appendText('"\n    }\n  }\n}\n')
  }

  private exists(file: vscode.Uri): Thenable<boolean> {
    return vscode.workspace.fs.stat(file).then(
      () => true,
      () => false,
    )
  }
}
