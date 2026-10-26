import { DefinitionsLoop } from "../../core/index.js"
import * as vscode from "vscode"
import type { Connection } from "../connections/connection.js"
import type { ConnectionRegistry } from "../connections/connection-registry.js"
import type { LiveWiring } from "../live/live-wiring.js"

export interface LiveTree {
  readonly visible: boolean
  readonly onDidChangeVisibility: vscode.Event<unknown>
  isExpanded(connection: Connection): boolean
  refreshEngine(connection: Connection): void
}

export class EnginesTreeLive implements vscode.Disposable {
  private loops = new Map<Connection, DefinitionsLoop>()
  private readonly subscription: vscode.Disposable

  constructor(
    private readonly registry: ConnectionRegistry,
    private readonly tree: LiveTree,
    private readonly live: LiveWiring,
  ) {
    const attend = () => {
      this.attend()
    }
    this.subscription = vscode.Disposable.from(
      registry.onDidChange(() => {
        this.rebuild()
      }),
      tree.onDidChangeVisibility(attend),
      live.attention.onDidChange(attend),
    )
    this.rebuild()
  }

  nudgeLocal(): void {
    for (const [connection, loop] of this.loops) {
      if (connection.badge.environment === "local") {
        loop.nudge()
      }
    }
  }

  dispose(): void {
    this.subscription.dispose()
    this.stopAll()
  }

  private rebuild(): void {
    this.stopAll()
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
        isExpanded: () => this.tree.isExpanded(connection),
        refreshed: () => {
          this.tree.refreshEngine(connection)
        },
      },
    )
  }

  private attend(): void {
    const attention = this.live.attention.of(this.tree.visible)
    for (const loop of this.loops.values()) {
      loop.attend(attention)
    }
  }

  private stopAll(): void {
    for (const loop of this.loops.values()) {
      loop.dispose()
    }
  }
}
