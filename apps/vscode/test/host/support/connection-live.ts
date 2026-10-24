import type { ProcessRuntime } from '../../../src/contract/index.js';
import { EngineLane, LiveSwitch, SharedDefinitions } from '../../../src/core/index.js';

export class ConnectionLive {
  static of(runtime: ProcessRuntime) {
    const lane = new EngineLane();
    return {
      definitions: new SharedDefinitions(runtime, lane),
      lane,
      live: new LiveSwitch('on'),
    };
  }
}
