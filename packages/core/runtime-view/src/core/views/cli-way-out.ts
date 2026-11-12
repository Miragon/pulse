import type { InstanceDetail, WaitState } from "@miragon/pulse-engine-core"
import type { EngineCli } from "../../ports/index.js"

export class CliWayOut {
  constructor(
    private readonly detail: InstanceDetail,
    private readonly cli: EngineCli | undefined,
  ) {}

  triggering(waitState: WaitState, label: string): string | undefined {
    const command = this.cli?.triggerCommand(this.detail, waitState)
    return command === undefined ? undefined : `Trigger ${label} with the CLI: ${command}`
  }
}
