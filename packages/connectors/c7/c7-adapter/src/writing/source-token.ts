import { RuntimeError } from "@miragon/pulse-engine-core"
import { multiInstanceBodyOf } from "@miragon/pulse-c7-core"
import type { ActivityInstanceRow } from "@miragon/pulse-c7-core/runtime"

export interface SourceTokenRef {
  readonly field: "activityInstanceId" | "transitionInstanceId"
  readonly id: string
}

export class SourceToken {
  static in(tree: ActivityInstanceRow, elementId: string): SourceTokenRef {
    const scopes = SourceToken.scopesOf(tree)
    const body = multiInstanceBodyOf(elementId)
    if (scopes.some((scope) => scope.activityId === body)) {
      throw new RuntimeError(
        "rejected",
        `${elementId} runs as multi-instance; Pulse moves only a single token.`,
      )
    }
    const tokens = [
      ...scopes
        .filter((scope) => scope !== tree && scope.activityId === elementId)
        .map((scope) => ({ field: "activityInstanceId", id: scope.id }) as const),
      ...scopes
        .flatMap((scope) => scope.childTransitionInstances)
        .filter((transition) => transition.activityId === elementId)
        .map((transition) => ({ field: "transitionInstanceId", id: transition.id }) as const),
    ]
    const [token, ...more] = tokens
    if (token === undefined) {
      throw new RuntimeError("rejected", `No token waits at ${elementId}.`)
    }
    if (more.length > 0) {
      throw new RuntimeError(
        "rejected",
        `${tokens.length} tokens wait at ${elementId}; Pulse moves only a single token.`,
      )
    }
    return token
  }

  private static scopesOf(scope: ActivityInstanceRow): ActivityInstanceRow[] {
    return [scope, ...scope.childActivityInstances.flatMap((child) => SourceToken.scopesOf(child))]
  }
}
