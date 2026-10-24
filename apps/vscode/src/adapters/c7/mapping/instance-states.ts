import { RuntimeError, type InstanceState } from '../../../contract/index.js';

const INSTANCE_STATES: ReadonlyMap<string, InstanceState> = new Map<string, InstanceState>([
  ['ACTIVE', 'running'],
  ['SUSPENDED', 'suspended'],
  ['COMPLETED', 'completed'],
  ['EXTERNALLY_TERMINATED', 'terminated'],
  ['INTERNALLY_TERMINATED', 'terminated'],
]);

export class InstanceStates {
  static of(engineState: string): InstanceState {
    const state = INSTANCE_STATES.get(engineState);
    if (state === undefined) {
      throw new RuntimeError('unexpectedResponse', `Unknown process instance state ${engineState}`);
    }
    return state;
  }
}
