import { BulkRuns } from '../../core/index.js';
import type { EngineTarget } from './engine-target.js';

export class EngineBulkRuns {
  private readonly runs = new Map<string, BulkRuns>();

  of(target: EngineTarget): BulkRuns {
    const url = new URL(target.endpoint);
    const key = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    const known = this.runs.get(key);
    if (known !== undefined) {
      return known;
    }
    const runs = new BulkRuns();
    this.runs.set(key, runs);
    return runs;
  }
}
