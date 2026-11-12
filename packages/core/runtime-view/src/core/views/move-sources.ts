import type { WaitState } from "@miragon/pulse-engine-core"
import type { FlowNodes } from "../bpmn/flow-nodes.js"
import type { ActiveTokens } from "./active-tokens.js"
import type { CliWayOut } from "./cli-way-out.js"
import type { ElementLabels } from "./element-labels.js"
import { Labels } from "./labels.js"

const ANY_OF = new Intl.ListFormat("en", { type: "disjunction" })

export interface MoveRefusal {
  readonly moveRefusal: string
  readonly cliCommand?: string
}

export class MoveSources {
  constructor(
    private readonly nodes: FlowNodes,
    private readonly tokens: ActiveTokens,
    private readonly labels: ElementLabels,
    private readonly cli: CliWayOut,
  ) {}

  refusalOf(waitState: WaitState, instanceId: string): MoveRefusal | undefined {
    if (waitState.instanceId !== instanceId) {
      return { moveRefusal: "Open the called instance to move this token." }
    }
    const gateway = this.nodes.eventGatewayBefore(waitState.elementId)
    if (gateway !== undefined && waitState.kind !== "asyncContinuation") {
      return this.gatewayRefusal(gateway, waitState)
    }
    if (waitState.attachedToElementId !== undefined) {
      const host = this.labels.of(waitState.attachedToElementId)
      return { moveRefusal: `This event belongs to ${host}; move the token at ${host} instead.` }
    }
    const refusal = this.elementRefusal(waitState.elementId)
    return refusal === undefined ? undefined : { moveRefusal: refusal }
  }

  private gatewayRefusal(gateway: string, waitState: WaitState): MoveRefusal {
    const waits = `The token waits at the gateway ${this.labels.of(gateway)} until one of the events after it occurs; Pulse does not move a token away from an event-based gateway.`
    const conditions = this.nodes.conditionsAfter(gateway).map((id) => this.labels.of(id))
    const variables =
      conditions.length === 0
        ? undefined
        : `Change a variable on the Variables tab to meet the condition of ${ANY_OF.format(conditions)}.`
    const trigger = this.cli.triggering(waitState, this.labels.of(waitState.elementId))
    const moveRefusal = [waits, variables, trigger?.sentence]
      .filter((sentence) => sentence !== undefined)
      .join(" ")
    return trigger === undefined ? { moveRefusal } : { moveRefusal, cliCommand: trigger.command }
  }

  private elementRefusal(elementId: string): string | undefined {
    const kind = this.nodes.kindOf(elementId)
    const count = this.tokens.at(elementId)
    if (kind === undefined) {
      return "Pulse does not find this element in the deployed diagram."
    }
    if (this.nodes.isSubProcess(elementId)) {
      return "Move a token inside the sub-process instead."
    }
    if (count > 1) {
      return `${Labels.count(count)} tokens wait here; Pulse moves only a single one.`
    }
    if (this.nodes.isMultiInstance(elementId)) {
      return "This element runs as multi-instance; Pulse moves only single tokens."
    }
    return this.nodes.isInEventSubProcess(elementId)
      ? "Pulse does not move tokens inside an event sub-process."
      : this.ambiguousScope(elementId)
  }

  private ambiguousScope(elementId: string): string | undefined {
    const repeated = this.nodes
      .scopesAround(elementId)
      .find((scope) => this.tokens.runsOf(scope) > 1)
    return repeated === undefined
      ? undefined
      : `${this.labels.of(repeated)} runs more than once; Pulse moves only unambiguous tokens.`
  }
}
