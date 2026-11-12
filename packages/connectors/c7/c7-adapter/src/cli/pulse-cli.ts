import type { InstanceDetail, WaitState, WaitStateKind } from "@miragon/pulse-engine-core"
import type { CliTarget, EngineCli } from "@miragon/pulse-runtime-view/ports"

const PLAIN = /^[\w.:@/+=-]+$/
const TRIGGERED_BY_ADVANCE: ReadonlySet<WaitStateKind> = new Set(["message", "signal", "timer"])

export class PulseCli implements EngineCli {
  constructor(private readonly target: CliTarget) {}

  triggerCommand(detail: InstanceDetail, waitState: WaitState): string | undefined {
    if (!TRIGGERED_BY_ADVANCE.has(waitState.kind) || !PulseCli.aloneAt(detail, waitState)) {
      return undefined
    }
    const instance = PulseCli.shellWord(waitState.instanceId)
    const element = PulseCli.shellWord(waitState.elementId)
    return `pulse advance ${instance} --activity-id ${element} ${this.targetOptions()}`
  }

  private targetOptions(): string {
    return this.target.kind === "profile"
      ? `--profile ${PulseCli.shellWord(this.target.name)}`
      : `--url ${PulseCli.shellWord(this.target.endpoint)} --auth none`
  }

  private static aloneAt(detail: InstanceDetail, waitState: WaitState): boolean {
    const waits = detail.waitStates.filter((other) => other.elementId === waitState.elementId)
    return waits.length === 1
  }

  private static shellWord(value: string): string {
    return PLAIN.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`
  }
}
