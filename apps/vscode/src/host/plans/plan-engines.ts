import { FailingRuntime } from "@miragon/pulse-engine-core"
import type { Connection, EngineRoot } from "@miragon/pulse-runtime-view/host-kit"
import * as vscode from "vscode"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { ConnectionPicker } from "../commands/connection-picker.js"

export class PlanEngines {
  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly picker: ConnectionPicker,
    private readonly engines: Pick<EngineRoot, "plans">,
  ) {}

  async choose(title: string, preferred?: string): Promise<Connection | undefined> {
    const connections = this.registry.all()
    const candidates = connections.filter((connection) => PlanEngines.plans(connection))
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage(this.noEngineText(connections))
      return undefined
    }
    const known = candidates.find(({ target }) => target.name === preferred)
    if (known !== undefined || candidates.length === 1) {
      return known ?? candidates[0]
    }
    return this.picker.pick(title, candidates)
  }

  private noEngineText(connections: readonly Connection[]): string {
    if (connections.length === 0) {
      return "Pulse lists no engine, so it can't check a plan. Configure one in the Engines view."
    }
    const [first, ...others] = connections
      .filter(
        ({ runtime, target }) => runtime instanceof FailingRuntime && this.engines.plans(target),
      )
      .map(({ target }) => target.name)
    if (first === undefined) {
      return "None of the configured engines checks migration plans, so Pulse can't check one."
    }
    const last = others.pop()
    return last === undefined
      ? `Pulse refuses the connection to ${first}, so it can't check a plan there. Expand ${first} in the Engines view to see why and what to change.`
      : `Pulse refuses the connections to ${[first, ...others].join(", ")} and ${last}, so it can't check a plan there. Expand them in the Engines view to see why and what to change.`
  }

  private static plans({ runtime }: Connection): boolean {
    return !(runtime instanceof FailingRuntime) && runtime.checkMigration !== undefined
  }
}
