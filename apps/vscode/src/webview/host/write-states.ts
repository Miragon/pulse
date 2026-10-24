import type { WriteState, WriteTarget } from '../../core/protocol/index.js';

export class WriteStates {
  static on(state: WriteState | undefined, target: WriteTarget): WriteState | undefined {
    return state !== undefined && WriteStates.sameTarget(state.target, target) ? state : undefined;
  }

  static isWriting(state: WriteState | undefined): boolean {
    return state?.status === 'pending';
  }

  private static sameTarget(left: WriteTarget, right: WriteTarget): boolean {
    if (left.kind === 'incident' && right.kind === 'incident') {
      return left.incidentId === right.incidentId;
    }
    if (left.kind === 'token' && right.kind === 'token') {
      return left.fromElementId === right.fromElementId;
    }
    return left.kind === 'variable' && right.kind === 'variable' && left.name === right.name;
  }
}
