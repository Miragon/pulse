import { RuntimeError, type RuntimeFailure } from '../../contract/index.js';

const STOPPING: ReadonlySet<RuntimeFailure> = new Set<RuntimeFailure>([
  'unauthorized',
  'forbidden',
  'misconfigured',
]);

export class LiveFailures {
  static stopsLiveUpdates(error: unknown): boolean {
    return RuntimeError.is(error) && STOPPING.has(error.failure);
  }
}
