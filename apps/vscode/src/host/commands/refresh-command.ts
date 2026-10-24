import type { ConnectionRegistry } from '../connections/connection-registry.js';
import type { Command } from './command.js';
import { COMMAND } from './command-ids.js';

export class RefreshCommand implements Command {
  readonly id = COMMAND.refresh;

  constructor(private readonly registry: ConnectionRegistry) {}

  run(): Promise<void> {
    return this.registry.reload();
  }
}
