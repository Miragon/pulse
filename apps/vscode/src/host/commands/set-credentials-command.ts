import * as vscode from "vscode"
import type { Connection } from "../connections/connection.js"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { CredentialStore } from "../connections/credential-store.js"
import type { EngineTarget } from "../connections/engine-target.js"
import { TargetHosts, type CredentialHosts } from "../connections/target-hosts.js"
import { TargetPolicy } from "../connections/target-policy.js"
import { TargetsFile } from "../connections/targets-file.js"
import type { Command } from "./command.js"
import { COMMAND } from "./command-ids.js"
import type { ConnectionPicker } from "./connection-picker.js"
import type { OpenTargetsFileCommand } from "./open-targets-file-command.js"

const OPEN_FILE = "Open the project file"
const NO_CREDENTIALS = { kind: "none" } as const

export class SetCredentialsCommand implements Command {
  readonly id = COMMAND.setCredentials

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly store: CredentialStore,
    private readonly picker: ConnectionPicker,
    private readonly projectFile: OpenTargetsFileCommand,
  ) {}

  async run(node?: { readonly connection?: Connection }): Promise<void> {
    const chosen = node?.connection ?? (await this.picker.pick("Set Credentials"))
    if (chosen === undefined) {
      return
    }
    const { target } = chosen
    const refused = TargetPolicy.refusal(target, NO_CREDENTIALS)
    const hosts = TargetHosts.credentialHosts(target)
    if (refused !== undefined) {
      await this.explain(target, refused)
    } else if (hosts === undefined) {
      await this.explain(target, this.withoutAuthType(target))
    } else {
      await this.ask(target, hosts)
    }
  }

  private async ask(target: EngineTarget, hosts: CredentialHosts): Promise<void> {
    const [identity, secret] =
      target.auth.kind === "clientCredentials"
        ? ["Client ID", "Client secret"]
        : ["Username", "Password"]
    const prompt =
      hosts.tokens === undefined
        ? `Pulse sends it to ${hosts.secret}.`
        : `Pulse sends it to ${hosts.secret} and the tokens it gets to ${hosts.tokens}.`
    const username = await vscode.window.showInputBox({
      title: `${identity} for ${target.name}`,
      prompt,
    })
    if (username === undefined) {
      return
    }
    const password = await vscode.window.showInputBox({
      title: `${secret} for ${target.name}`,
      prompt,
      password: true,
    })
    if (password === undefined) {
      return
    }
    await this.store.write(target, username, password)
    await this.registry.reload()
  }

  private withoutAuthType(target: EngineTarget): string {
    const types = this.registry.catalogue().credentialTypesOf(target.engine).join(" or ")
    return target.source.kind === "file"
      ? `The profile ${target.name} has no auth type, so Pulse sends no credentials. Set its auth.type to ${types} in ${TargetsFile.NAME}.`
      : `${target.name} has no profile, so Pulse sends no credentials. Add a profile with an auth.type of ${types} to ${TargetsFile.NAME}.`
  }

  private async explain(target: EngineTarget, why: string): Promise<void> {
    const choice = await vscode.window.showInformationMessage(why, OPEN_FILE)
    if (choice === OPEN_FILE) {
      await this.projectFile.run(target.source.kind === "file" ? target.source.path : undefined)
    }
  }
}
