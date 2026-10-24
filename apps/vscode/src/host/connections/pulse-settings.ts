import * as vscode from 'vscode';
import type { Environment } from '../../core/protocol/index.js';
import { LivePolicy } from './live-policy.js';
import { WritePolicy, type WritesSetting } from './write-policy.js';

type Scoped = Readonly<Record<string, unknown>>;

export interface EnvironmentSettings {
  readonly user: Scoped | undefined;
  readonly workspace: readonly (Scoped | undefined)[];
}

export class PulseSettings {
  static environments(): EnvironmentSettings {
    const inspected = vscode.workspace.getConfiguration('pulse').inspect<Scoped>('environments');
    return {
      user: inspected?.globalValue,
      workspace: [inspected?.workspaceValue, inspected?.workspaceFolderValue],
    };
  }

  static writes(): WritesSetting {
    return WritePolicy.settingOf(
      vscode.workspace.getConfiguration('pulse').inspect('writes')?.globalValue,
    );
  }

  static liveUpdates(): unknown {
    return vscode.workspace.getConfiguration('pulse').inspect('liveUpdates')?.globalValue;
  }

  static async turnOnLiveUpdates(environment: Environment): Promise<void> {
    const user = PulseSettings.liveUpdates();
    await vscode.workspace
      .getConfiguration('pulse')
      .update(
        'liveUpdates',
        LivePolicy.turnedOn(user, environment),
        vscode.ConfigurationTarget.Global,
      );
  }
}
