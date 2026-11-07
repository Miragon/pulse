import { DefinitionsLoop } from "../../../src/core/index.js"
import type { Connection } from "../../../src/host/connections/connection.js"
import type { EngineRegistry } from "./engine-registry.js"
import type { OrcaLive } from "./orca-live.js"

export class EnginesLive {
  private loops = new Map<Connection, DefinitionsLoop>()
  private visible = false

  constructor(
    private readonly registry: EngineRegistry,
    private readonly live: OrcaLive,
    private readonly refreshed: (connection: Connection) => void,
  ) {
    registry.onDidChange(() => {
      this.rebuild()
    })
    live.onDidChange(() => {
      this.attend()
    })
  }

  show(visible: boolean): void {
    this.visible = visible
    if (visible) {
      this.live.noteActivity()
    }
    this.attend()
  }

  nudgeLocal(): void {
    for (const [connection, loop] of this.loops) {
      if (connection.badge.environment === "local") {
        loop.nudge()
      }
    }
  }

  dispose(): void {
    for (const loop of this.loops.values()) {
      loop.dispose()
    }
    this.loops.clear()
  }

  private rebuild(): void {
    this.dispose()
    this.loops = new Map(
      this.registry.all().map((connection) => [connection, this.loopOf(connection)]),
    )
    this.attend()
  }

  private loopOf(connection: Connection): DefinitionsLoop {
    return new DefinitionsLoop(
      {
        live: this.live.contextFor(connection),
        definitions: connection.definitions,
        environment: connection.badge.environment,
        now: () => new Date(),
      },
      {
        isExpanded: () => true,
        refreshed: () => {
          this.refreshed(connection)
        },
      },
    )
  }

  private attend(): void {
    const attention = this.live.of(this.visible)
    for (const loop of this.loops.values()) {
      loop.attend(attention)
    }
  }
}
