import { BulkRuns } from "@miragon/pulse-runtime-view/core"
import { EndpointPath, type EngineTarget } from "@miragon/pulse-runtime-view/host-kit"

export class EngineBulkRuns {
  private readonly runs = new Map<string, BulkRuns>()

  of(target: EngineTarget): BulkRuns {
    const url = new URL(target.endpoint)
    const key = `${url.origin}${EndpointPath.withoutTrailingSlashes(url.pathname)}`
    const known = this.runs.get(key)
    if (known !== undefined) {
      return known
    }
    const runs = new BulkRuns()
    this.runs.set(key, runs)
    return runs
  }
}
