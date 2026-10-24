import type { WriteRequest } from '../../core/index.js';
import * as vscode from 'vscode';
import type { Confirmation } from '../connections/confirmation-policy.js';
import { NotificationText } from '../notification-text.js';

const NO_LOGIN: Readonly<Record<string, string>> = {
  moveToken: 'No login: the engine records neither who nor why.',
  migrateInstances: "No login: the engine doesn't record who migrated.",
};

export interface WriteTargetEngine {
  readonly name: string;
  readonly environment: string;
  readonly host: string;
  readonly identity?: string;
}

export type DialogRequest = Pick<WriteRequest, 'title' | 'facts' | 'confirmLabel'> & {
  readonly action: string;
};

export class WriteDialog {
  constructor(
    private readonly request: DialogRequest,
    private readonly engine: WriteTargetEngine,
  ) {}

  async confirm(confirmation: Confirmation): Promise<boolean> {
    if (confirmation === 'none') {
      return true;
    }
    if (!(await this.confirmedInModal())) {
      return false;
    }
    return confirmation === 'modal' || this.hostTyped();
  }

  async confirmedInModal(): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      NotificationText.printable(this.request.title),
      { modal: true, detail: this.detail() },
      this.request.confirmLabel,
    );
    return choice === this.request.confirmLabel;
  }

  async hostTyped(): Promise<boolean> {
    const engine = this.engine;
    const typed = await vscode.window.showInputBox({
      title: `Type ${engine.host} to confirm`,
      prompt: `${NotificationText.printable(engine.name)} (${engine.environment}) is not on this machine. Type its host to go ahead.`,
      ignoreFocusOut: true,
      validateInput: (value) => (value === engine.host ? undefined : `Type ${engine.host}`),
    });
    return typed === engine.host;
  }

  private detail(): string {
    const engine = this.engine;
    const who = engine.identity === undefined ? '' : ` · as ${engine.identity}`;
    const noLogin = Object.hasOwn(NO_LOGIN, this.request.action)
      ? NO_LOGIN[this.request.action]
      : undefined;
    const unrecorded = noLogin !== undefined && engine.identity === undefined ? [noLogin] : [];
    return [...this.request.facts, ...unrecorded, `Engine ${engine.name} · ${engine.host}${who}`]
      .map((line) => NotificationText.printable(line))
      .join('\n');
  }
}
