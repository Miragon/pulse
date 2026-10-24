import * as vscode from 'vscode';
import type { ConnectionRegistry } from '../connections/connection-registry.js';

export interface LocalNudge {
  nudgeLocal(): void;
}

const QUIET_AFTER_NUDGE_MS = 5000;

export class LiveTriggers implements vscode.Disposable {
  private readonly subscription: vscode.Disposable;
  private lastNudge = Number.NEGATIVE_INFINITY;
  private trailing: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly targets: readonly LocalNudge[],
  ) {
    const nudge = () => {
      this.nudge();
    };
    this.subscription = vscode.Disposable.from(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.uri.path.endsWith('.bpmn')) {
          nudge();
        }
      }),
      vscode.debug.onDidTerminateDebugSession(nudge),
      vscode.tasks.onDidEndTaskProcess(nudge),
    );
  }

  dispose(): void {
    clearTimeout(this.trailing);
    this.subscription.dispose();
  }

  private nudge(): void {
    const quietFor = this.lastNudge + QUIET_AFTER_NUDGE_MS - Date.now();
    if (quietFor > 0) {
      this.trailing ??= setTimeout(() => {
        this.trailing = undefined;
        this.nudge();
      }, quietFor);
      return;
    }
    this.lastNudge = Date.now();
    for (const connection of this.registry.all()) {
      if (connection.badge.environment === 'local') {
        connection.definitions.forget();
      }
    }
    for (const target of this.targets) {
      target.nudgeLocal();
    }
  }
}
