import type { Connection } from '../../../src/host/connections/connection.js';
import type { ConnectionRegistry } from '../../../src/host/connections/connection-registry.js';
import { EventEmitter } from './vscode-fake.js';

export class FakeRegistry {
  private readonly changed = new EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  readonly onDidWrite = new EventEmitter<void>().event;

  constructor(private connections: readonly Connection[]) {}

  asRegistry(): ConnectionRegistry {
    return this as unknown as ConnectionRegistry;
  }

  reload(connections: readonly Connection[]): void {
    this.connections = connections;
    this.changed.fire();
  }

  all(): readonly Connection[] {
    return this.connections;
  }

  byName(name: string): Connection | undefined {
    return this.connections.find((connection) => connection.target.name === name);
  }

  active(): Connection | undefined {
    return this.connections[0];
  }

  configurationProblems(): readonly [] {
    return [];
  }
}
