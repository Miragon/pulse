import type { InstanceDetail, WaitState } from '../../contract/index.js';
import type { WaitRow } from '../protocol/index.js';
import type { CalledInstanceLinks } from './called-instance-links.js';
import { Labels } from './labels.js';

export class WaitRows {
  constructor(
    private readonly detail: InstanceDetail,
    private readonly links: CalledInstanceLinks,
  ) {}

  rows(): WaitRow[] {
    return this.detail.waitStates.map((waitState) => this.rowOf(waitState));
  }

  private rowOf(waitState: WaitState): WaitRow {
    const text = this.detailOf(waitState);
    const dueAt =
      waitState.kind === 'timer' || waitState.kind === 'userTask' ? waitState.dueAt : undefined;
    const link = this.links.linkTo(waitState.instanceId);
    return {
      elementId: waitState.elementId,
      kindLabel: Labels.waitKind(waitState.kind),
      ...(waitState.elementName === undefined ? {} : { elementName: waitState.elementName }),
      ...(text === undefined ? {} : { detail: text }),
      ...(waitState.since === undefined ? {} : { since: waitState.since }),
      ...(dueAt === undefined ? {} : { dueAt }),
      ...(link === undefined ? {} : { calledInstance: link }),
    };
  }

  private detailOf(waitState: WaitState): string | undefined {
    switch (waitState.kind) {
      case 'userTask':
        return waitState.assignee === undefined
          ? 'Unassigned'
          : `Assigned to ${waitState.assignee}`;
      case 'workerTask':
        return `Task type ${waitState.taskType}`;
      case 'asyncContinuation':
        return waitState.retriesLeft === undefined
          ? undefined
          : `${waitState.retriesLeft} retries left`;
      case 'message':
        return waitState.messageName;
      case 'signal':
        return waitState.signalName;
      case 'other':
        return waitState.description;
      case 'timer':
        return undefined;
    }
  }
}
