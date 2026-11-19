import * as vscode from "vscode"
import type { Connection } from "@miragon/pulse-runtime-view/host-kit"
import type { OpenTargetsFileCommand } from "./open-targets-file-command.js"
import { ProfileFileAction } from "./profile-file-action.js"
import type { SetCredentialsCommand } from "./set-credentials-command.js"

export class ConnectionEditor {
  constructor(
    private readonly setCredentials: SetCredentialsCommand,
    private readonly openTargetsFile: OpenTargetsFileCommand,
  ) {}

  async setCredentialsOf(connection: Connection): Promise<void> {
    await this.setCredentials.run({ connection })
  }

  async edit(connection: Connection): Promise<void> {
    const { target } = connection
    const choice = await vscode.window.showQuickPick(
      [
        { label: `Set credentials for ${target.name}…`, action: "credentials" as const },
        { label: ProfileFileAction.labelOf(target), action: "file" as const },
      ],
      { title: `Edit connection ${target.name}` },
    )
    if (choice?.action === "credentials") {
      await this.setCredentialsOf(connection)
    } else if (choice?.action === "file") {
      await this.openTargetsFile.run(ProfileFileAction.pathOf(target))
    }
  }
}
