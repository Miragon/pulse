import type { Connection } from "../connections/connection.js"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { Command } from "./command.js"
import type { CommandId } from "./command-ids.js"

export abstract class EngineCommand implements Command {
  abstract readonly id: CommandId

  constructor(private readonly registry: ConnectionRegistry) {}

  run(engine: unknown, ...values: unknown[]): void {
    const connection = typeof engine === "string" ? this.registry.byName(engine) : undefined
    if (connection !== undefined && values.every((value) => typeof value === "string")) {
      this.runOn(connection, values)
    }
  }

  protected abstract runOn(connection: Connection, values: readonly string[]): void
}
