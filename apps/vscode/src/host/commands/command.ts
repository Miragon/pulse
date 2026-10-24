import type { CommandId } from "./command-ids.js"

export interface Command {
  readonly id: CommandId
  run(...args: unknown[]): Promise<void> | void
}
