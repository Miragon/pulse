import * as vscode from 'vscode';
import type { Connection } from '../connections/connection.js';
import type { ConnectionRegistry } from '../connections/connection-registry.js';

export class ConnectionPicker {
  constructor(private readonly registry: ConnectionRegistry) {}

  async pick(title: string): Promise<Connection | undefined> {
    const picked = await vscode.window.showQuickPick(
      this.registry.all().map((connection) => ({
        label: connection.target.name,
        description: `${connection.badge.environment} · ${connection.target.endpoint}`,
        connection,
      })),
      { title },
    );
    return picked?.connection;
  }
}
