import * as vscode from "vscode"
import {
  type Connection,
  type CredentialStore,
  type EngineTarget,
  type LoginAsk,
  TargetLogin,
} from "@miragon/pulse-runtime-view/host-kit"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"
import type { ConnectionPicker } from "./connection-picker.js"
import type { OpenTargetsFileCommand } from "./open-targets-file-command.js"
import { ProfileFileAction } from "./profile-file-action.js"

export class SetCredentialsCommand implements Command {
  readonly id = COMMAND.setCredentials

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly store: CredentialStore,
    private readonly picker: ConnectionPicker,
    private readonly profileFile: OpenTargetsFileCommand,
  ) {}

  async run(node?: { readonly connection?: Connection }): Promise<void> {
    const chosen = node?.connection ?? (await this.picker.pick("Set Credentials"))
    if (chosen === undefined) {
      return
    }
    const login = TargetLogin.of(chosen.target)
    if ("refused" in login) {
      await this.explain(chosen.target, login.refused)
    } else {
      await this.ask(chosen.target, login)
    }
  }

  private async ask(target: EngineTarget, { fields, sendsTo }: LoginAsk): Promise<void> {
    const identity =
      fields.identity === undefined
        ? undefined
        : await SetCredentialsCommand.input(`${fields.identity} for ${target.name}`, sendsTo)
    if (fields.identity !== undefined && identity === undefined) {
      return
    }
    const title = `${fields.secret} for ${target.name}`
    const secret = await SetCredentialsCommand.input(title, sendsTo, true)
    if (secret === undefined) {
      return
    }
    await this.store.write(target, { ...(identity === undefined ? {} : { identity }), secret })
    await this.registry.reload()
  }

  private async explain(target: EngineTarget, why: string): Promise<void> {
    const open = ProfileFileAction.labelOf(target)
    const choice = await vscode.window.showInformationMessage(why, open)
    if (choice === open) {
      await this.profileFile.run(ProfileFileAction.pathOf(target))
    }
  }

  private static input(
    title: string,
    prompt: string,
    password = false,
  ): Thenable<string | undefined> {
    return vscode.window.showInputBox({ title, prompt, ...(password ? { password } : {}) })
  }
}
