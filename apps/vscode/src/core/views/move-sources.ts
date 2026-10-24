import type { WaitState } from '../../contract/index.js';
import type { FlowNodes } from '../bpmn/flow-nodes.js';
import type { ActiveTokens } from './active-tokens.js';
import type { ElementLabels } from './element-labels.js';

export class MoveSources {
  constructor(
    private readonly nodes: FlowNodes,
    private readonly tokens: ActiveTokens,
    private readonly labels: ElementLabels,
  ) {}

  refusalOf(waitState: WaitState, instanceId: string): string | undefined {
    if (waitState.instanceId !== instanceId) {
      return 'Open the called instance to move this token.';
    }
    const gateway = this.nodes.eventGatewayBefore(waitState.elementId);
    if (gateway !== undefined) {
      return `The token waits at the gateway ${this.labels.of(gateway)}; Pulse does not move it yet.`;
    }
    if (waitState.attachedToElementId !== undefined) {
      const host = this.labels.of(waitState.attachedToElementId);
      return `This event belongs to ${host}; move the token at ${host} instead.`;
    }
    return this.elementRefusal(waitState.elementId);
  }

  private elementRefusal(elementId: string): string | undefined {
    const kind = this.nodes.kindOf(elementId);
    const count = this.tokens.at(elementId);
    if (kind === undefined) {
      return 'Pulse does not find this element in the deployed diagram.';
    }
    if (this.nodes.isSubProcess(elementId)) {
      return 'Move a token inside the sub-process instead.';
    }
    if (count > 1) {
      return `${count} tokens wait here; Pulse moves only a single one.`;
    }
    if (this.nodes.isMultiInstance(elementId)) {
      return 'This element runs as multi-instance; Pulse moves only single tokens.';
    }
    return this.nodes.isInEventSubProcess(elementId)
      ? 'Pulse does not move tokens inside an event sub-process.'
      : this.ambiguousScope(elementId);
  }

  private ambiguousScope(elementId: string): string | undefined {
    const repeated = this.nodes
      .scopesAround(elementId)
      .find((scope) => this.tokens.runsOf(scope) > 1);
    return repeated === undefined
      ? undefined
      : `${this.labels.of(repeated)} runs more than once; Pulse moves only unambiguous tokens.`;
  }
}
