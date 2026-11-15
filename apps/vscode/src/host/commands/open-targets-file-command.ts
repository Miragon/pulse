import * as vscode from "vscode"
import { TargetMerge, type UserConfigLocation } from "@miragon/pulse-runtime-view/host-kit"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import { TargetsFile } from "../connections/targets-file.js"
import { UserConfigFile } from "../connections/user-config-file.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"
import { ProfileFileChoice, type ProfileHome } from "./profile-file-choice.js"

export class OpenTargetsFileCommand implements Command {
  readonly id = COMMAND.openTargetsFile

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly locate: () => UserConfigLocation = () => UserConfigFile.location(),
  ) {}

  async run(path?: unknown): Promise<void> {
    const location = this.locate()
    if (location.isRelative()) {
      void vscode.window.showWarningMessage(TargetMerge.RELATIVE)
      return
    }
    const known = this.knownFiles()
    const home =
      typeof path === "string" && known.includes(path)
        ? OpenTargetsFileCommand.homeOf(path, location)
        : await ProfileFileChoice.pick(known, location)
    if (home !== undefined) {
      await this.open(home)
    }
  }

  private knownFiles(): string[] {
    return [
      ...this.registry
        .all()
        .flatMap(({ target }) => (target.source.kind === "default" ? [] : [target.source.path])),
      ...this.registry.configurationProblems().map((problem) => problem.path),
    ]
  }

  private async open(home: ProfileHome): Promise<void> {
    if (home.scope === "known") {
      await vscode.window.showTextDocument(home.file)
      return
    }
    if (home.scope === "project") {
      await vscode.window.showTextDocument(await this.projectFile(home.file))
      return
    }
    const created = await UserConfigFile.createIfMissing(home.file.fsPath)
    const editor = await vscode.window.showTextDocument(home.file)
    if (created) {
      const whole = new vscode.Range(0, 0, editor.document.lineCount, 0)
      await editor.insertSnippet(
        OpenTargetsFileCommand.firstProfile(),
        editor.document.validateRange(whole),
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

  private exists(file: vscode.Uri): Thenable<boolean> {
    return vscode.workspace.fs.stat(file).then(
      () => true,
      () => false,
    )
  }

  private static homeOf(path: string, location: UserConfigLocation): ProfileHome {
    const own = vscode.Uri.file(location.path)
    const file = vscode.Uri.file(path)
    return file.fsPath === own.fsPath ? { scope: "user", file: own } : { scope: "known", file }
  }

  private static firstProfile(): vscode.SnippetString {
    return new vscode.SnippetString()
      .appendText('{\n  "profiles": {\n    "')
      .appendPlaceholder("dev")
      .appendText('": {\n      "url": "')
      .appendPlaceholder("https://dev.example.com/engine-rest")
      .appendText('"\n    }\n  }\n}\n')
  }
}
