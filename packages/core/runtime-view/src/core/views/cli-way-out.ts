import type { InstanceDetail, WaitState } from "@miragon/pulse-engine-core"
import type { EngineCli } from "../../ports/index.js"

interface CliTrigger {
  readonly sentence: string
  readonly command: string
}

export class CliWayOut {
  constructor(
    private readonly detail: InstanceDetail,
    private readonly cli: EngineCli | undefined,
  ) {}

  triggering(waitState: WaitState, label: string): CliTrigger | undefined {
    const command = this.cli?.triggerCommand(this.detail, waitState)
    return command === undefined
      ? undefined
      : { sentence: `Trigger ${label} with the CLI: ${command}`, command }
  }
}
