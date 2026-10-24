import type { Environment } from "../protocol/index.js"
import type { Attention, LiveContext } from "./live-context.js"
import { RefreshLoop, type TickOutcome } from "./refresh-loop.js"
import type { SharedDefinitions } from "./shared-definitions.js"

export interface DefinitionsSource {
  readonly live: LiveContext
  readonly definitions: SharedDefinitions
  readonly environment: Environment
  readonly now: () => Date
}

export interface DefinitionsView {
  isExpanded(): boolean
  refreshed(): void
}

export class DefinitionsLoop {
  private readonly loop: RefreshLoop

  constructor(
    private readonly source: DefinitionsSource,
    private readonly view: DefinitionsView,
  ) {
    this.loop = new RefreshLoop(
      source.live,
      {
        refreshQuietly: () => this.refresh(),
        isBusy: () => !view.isExpanded(),
        hasEnded: () => false,
        showLive: () => undefined,
      },
      { view: "tree", environment: source.environment, now: source.now },
    )
  }

  attend(attention: Attention): void {
    this.loop.attend(attention)
  }

  nudge(): void {
    this.loop.nudge()
  }

  dispose(): void {
    this.loop.dispose()
  }

  private async refresh(): Promise<TickOutcome> {
    try {
      await this.source.definitions.read(0)
      this.view.refreshed()
      return "done"
    } catch {
      return this.source.live.lane.isBlocked ? "stopped" : "failed"
    }
  }
}
