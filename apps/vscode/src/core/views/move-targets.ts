import type { FlowNodes } from '../bpmn/flow-nodes.js';
import type { MoveTarget, RefusedTarget } from '../protocol/index.js';
import type { ActiveTokens } from './active-tokens.js';
import type { ElementLabels } from './element-labels.js';
import { MoveEffects } from './move-effects.js';

const REFUSED_KINDS: Readonly<Record<string, string>> = {
  startEvent: 'A start event begins a new path; pick the element after it.',
  boundaryEvent: 'A boundary event belongs to its task; pick the task instead.',
  endEvent: 'Moving the token to an end event can end the instance.',
};

export interface MoveTargetList {
  readonly targets: MoveTarget[];
  readonly refused: RefusedTarget[];
}

export class MoveTargets {
  private readonly effects: MoveEffects;

  constructor(
    private readonly nodes: FlowNodes,
    private readonly tokens: ActiveTokens,
    private readonly labels: ElementLabels,
  ) {
    this.effects = new MoveEffects(nodes, tokens, labels);
  }

  from(fromElementId: string, closesIncident: boolean): MoveTargetList {
    const list: MoveTargetList = { targets: [], refused: [] };
    const process = this.nodes.scopesAround(fromElementId).at(-1);
    for (const elementId of this.nodes.ids()) {
      const label = this.labels.of(elementId);
      const reason = this.refusalOf(elementId, process);
      if (reason === undefined) {
        const move = { from: fromElementId, to: elementId, closesIncident };
        list.targets.push({
          elementId,
          label,
          effects: this.effects.effects(move),
          warnings: this.effects.warnings(move),
        });
      } else {
        list.refused.push({ elementId, label, reason });
      }
    }
    return list;
  }

  private refusalOf(elementId: string, process: string | undefined): string | undefined {
    const byKind = REFUSED_KINDS[this.nodes.kindOf(elementId) ?? ''];
    if (byKind !== undefined) {
      return byKind;
    }
    if (this.nodes.scopesAround(elementId).at(-1) !== process) {
      return 'This element belongs to another process.';
    }
    const gateway = this.nodes.eventGatewayBefore(elementId);
    if (gateway !== undefined) {
      return `This event waits behind ${this.labels.of(gateway)}; move the token to ${this.labels.of(gateway)} instead.`;
    }
    return this.scopeRefusal(elementId);
  }

  private scopeRefusal(elementId: string): string | undefined {
    if (this.nodes.isInEventSubProcess(elementId)) {
      return 'Pulse does not start event sub-processes.';
    }
    if (this.nodes.isMultiInstance(elementId)) {
      return 'Pulse does not start multi-instance elements yet.';
    }
    const repeated = this.nodes
      .scopesAround(elementId)
      .find((scope) => this.tokens.runsOf(scope) > 1);
    return repeated === undefined
      ? undefined
      : `${this.labels.of(repeated)} runs more than once; Pulse can't tell which one to use.`;
  }
}
