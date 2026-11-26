import type { CallLinkData } from "./instance-screen-data.js"
import type { InstanceScopeCode } from "./instance-list-data.js"
import type { ElementBadgeData, ProcessScreenData } from "./process-screen-data.js"

export type BadgeCountKind = "incidents" | "incidentsInCalledInstances" | "running"

export interface BadgeCountData {
  readonly kind: BadgeCountKind
  readonly count: number
  readonly scope: Extract<InstanceScopeCode, "running" | "withIncident">
}

export interface ElementDecorationData {
  readonly elementId: string
  readonly counts: readonly BadgeCountData[]
  readonly incident: boolean
  readonly call: CallLinkData | null
}

const COUNTS: readonly (readonly [BadgeCountKind, BadgeCountData["scope"]])[] = [
  ["incidents", "withIncident"],
  ["incidentsInCalledInstances", "withIncident"],
  ["running", "running"],
]

export class DiagramDecorations {
  static of({
    badges,
    calls,
  }: Pick<ProcessScreenData, "badges" | "calls">): ElementDecorationData[] {
    const badged = new Set(badges.map((badge) => badge.elementId))
    return [
      ...badges.map((badge) => DiagramDecorations.badged(badge, calls)),
      ...calls
        .filter((call) => !badged.has(call.elementId))
        .map((call) => ({ elementId: call.elementId, counts: [], incident: false, call })),
    ]
  }

  private static badged(
    badge: ElementBadgeData,
    calls: readonly CallLinkData[],
  ): ElementDecorationData {
    return {
      elementId: badge.elementId,
      counts: COUNTS.flatMap(([kind, scope]) =>
        badge[kind] > 0 ? [{ kind, count: badge[kind], scope }] : [],
      ),
      incident: badge.incidents > 0,
      call: calls.find((call) => call.elementId === badge.elementId) ?? null,
    }
  }
}
