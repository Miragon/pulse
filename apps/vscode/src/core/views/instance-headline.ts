import type { InstanceState } from '../../contract/index.js';
import type { IncidentRow, Notice } from '../protocol/index.js';
import { Labels } from './labels.js';

export class InstanceHeadline {
  static of(rows: readonly IncidentRow[], state: InstanceState): Notice | undefined {
    const [first, second] = rows;
    if (first === undefined || second === undefined) {
      return InstanceHeadline.stateOf(state);
    }
    return {
      tone: 'danger',
      title: `${rows.length} incidents${state === 'suspended' ? ' · suspended' : ''}`,
      detail: first.rootCause ?? first.message,
      actions: [],
    };
  }

  private static stateOf(state: InstanceState): Notice | undefined {
    return state === 'running'
      ? undefined
      : {
          tone: 'info',
          title: `This instance is ${Labels.instanceState(state).toLowerCase()}.`,
          actions: [],
        };
  }
}
