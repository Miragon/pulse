import { createHash } from "node:crypto"
import { EngineLane } from "../../core/index.js"
import type { Credentials } from "./connection.js"
import type { EngineTarget } from "./engine-target.js"

export interface LaneRequest {
  readonly target: EngineTarget
  readonly credentials: Credentials
}

export class EngineLanes {
  private known: ReadonlyMap<string, EngineLane> = new Map()

  assign<Request extends LaneRequest>(
    requests: readonly Request[],
  ): (Request & { readonly lane: EngineLane })[] {
    const next = new Map<string, EngineLane>()
    const assigned = requests.map((request) => {
      const key = EngineLanes.keyOf(request)
      const lane = next.get(key) ?? this.known.get(key) ?? new EngineLane()
      next.set(key, lane)
      return { ...request, lane }
    })
    this.known = next
    return assigned
  }

  private static keyOf({ target, credentials }: LaneRequest): string {
    return createHash("sha256")
      .update(JSON.stringify([target.endpoint.replace(/\/+$/, ""), credentials]))
      .digest("hex")
  }
}
