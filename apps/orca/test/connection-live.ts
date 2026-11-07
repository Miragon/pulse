import type { ProcessRuntime } from "@miragon/pulse-runtime-view/contract"
import { EngineLane, LiveSwitch, SharedDefinitions } from "@miragon/pulse-runtime-view/core"

export class ConnectionLive {
  static of(runtime: ProcessRuntime) {
    const lane = new EngineLane()
    return {
      definitions: new SharedDefinitions(runtime, lane),
      lane,
      live: new LiveSwitch("on"),
    }
  }
}
