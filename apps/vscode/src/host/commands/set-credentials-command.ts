import * as vscode from 'vscode';
import type { Connection } from '../connections/connection.js';
import type { ConnectionRegistry } from '../connections/connection-registry.js';
import type { CredentialStore } from '../connections/credential-store.js';
import type { Command } from './command.js';
import { COMMAND } from './command-ids.js';
import type { ConnectionPicker } from './connection-picker.js';

export class SetCredentialsCommand implements Command {
  readonly id = COMMAND.setCredentials;

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly store: CredentialStore,
    private readonly picker: ConnectionPicker,
  ) {}

  async run(node?: { readonly connection?: Connection }): Promise<void> {
    const chosen = node?.connection ?? (await this.picker.pick('Set Credentials'));
    if (chosen === undefined) {
      return;
    }
    const username = await vscode.window.showInputBox({
      title: `Username for ${chosen.target.name}`,
    });
    if (username === undefined) {
      return;
    }
    const password = await vscode.window.showInputBox({
      title: `Password for ${chosen.target.name}`,
      password: true,
    });
    if (password === undefined) {
      return;
    }
    await this.store.write(chosen.target, username, password);
    await this.registry.reload();
  }
}
