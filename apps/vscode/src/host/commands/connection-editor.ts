import * as vscode from "vscode"
import { type Connection, ProfileSource } from "@miragon/pulse-runtime-view/host-kit"
import type { OpenTargetsFileCommand } from "./open-targets-file-command.js"
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
    const { source } = connection.target
    const file = source.kind === "default" ? undefined : source.path
    const choice = await vscode.window.showQuickPick(
      [
        { label: `Set credentials for ${connection.target.name}…`, action: "credentials" as const },
        {
          label:
            source.kind === "default"
              ? "Configure Engines…"
              : `Open ${ProfileSource.of(source.kind).inSentence(source.path)}`,
          action: "file" as const,
        },
      ],
      { title: `Edit connection ${connection.target.name}` },
    )
    if (choice?.action === "credentials") {
      await this.setCredentialsOf(connection)
    } else if (choice?.action === "file") {
      await this.openTargetsFile.run(file)
    }
  }
}
