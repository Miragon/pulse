import type { ConnectionRegistry } from '../connections/connection-registry.js';
import type { Command } from './command.js';
import { COMMAND } from './command-ids.js';
import type { ConnectionPicker } from './connection-picker.js';

export class SwitchEngineCommand implements Command {
  readonly id = COMMAND.switchEngine;

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly picker: ConnectionPicker,
  ) {}

  async run(): Promise<void> {
    const connection = await this.picker.pick('Switch Engine');
    if (connection !== undefined) {
      await this.registry.activate(connection.target.name);
    }
  }
}
