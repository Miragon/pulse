import { formatCount, formatNumber } from "@miragon/pulse-ui"
import { useT, type T } from "../../messages/use-t.js"
import { useEngineHealth } from "./engine-health.js"
import { engineStatusKind, type EngineStatusKind } from "./engine-status.js"

/** An engine's live health as its row reads it (`useEngineHealth`). */
type RowHealth = ReturnType<typeof useEngineHealth>

/** The states a row's words may give way to the root incidents outside any process. */
const QUIET: ReadonlySet<EngineStatusKind> = new Set(["failedJobs", "idle", "healthy"])

/**
 * A row's state on the landing and in the cross-engine view: `engineStatusKind`, and where the
 * engine's processes hold no open root incident while its verdict judged some outside any process
 * (a batch's or the history cleanup's failed job), those (`outside`), so the row never reads "no
 * incidents" beside the dot they make a warning (owner decision of 2026-11-26).
 */
export function engineRowKind(health: RowHealth): EngineStatusKind {
  const kind = engineStatusKind(health)
  return QUIET.has(kind) && (health.outside?.count ?? 0) > 0 ? "outside" : kind
}

/**
 * The count outside any process as the row says it: a lower bound (`≥ n`) where the server's
 * incident scan stopped.
 */
function outsideCount({ outside }: RowHealth): string {
  if (outside === undefined) return formatNumber(0)
  return formatCount(outside.atLeast ? { atLeast: outside.count } : outside.count)
}

/** A row's state in words, its count in the noun's number where it has one. */
function engineRowWords(kind: EngineStatusKind, health: RowHealth, t: T): string {
  if (kind === "incidents") {
    return t("cockpit.landing.status.incidents", { count: formatNumber(health.incidents) })
  }
  if (kind === "failedJobs") {
    return t("cockpit.landing.status.failedJobs", { count: formatNumber(health.failed) })
  }
  if (kind === "outside") {
    return t("cockpit.landing.status.outside", { count: outsideCount(health) })
  }
  return t(`cockpit.landing.status.${kind}`)
}

/** The incidents outside any process beside a read engine's id in the cross-engine view. */
function OutsideWords({ engineId, t }: { engineId: string; t: T }) {
  const health = useEngineHealth(engineId)
  const kind = engineRowKind(health)
  if (kind !== "outside") return null
  return (
    <span data-part="engine-outside" className="text-muted-foreground text-small">
      {engineRowWords(kind, health, t)}
    </span>
  )
}

/**
 * The words beside an engine's id in the cross-engine view: where its overview stands while it is
 * not read, the landing's words for it; once read its figures stand in the row, so only its root
 * incidents outside any process, which no figure counts.
 */
export function FleetRowWords({
  engineId,
  state,
  t,
}: {
  engineId: string
  state: "read" | EngineStatusKind
  t: T
}) {
  if (state === "read") return <OutsideWords engineId={engineId} t={t} />
  return (
    <span className="text-muted-foreground text-small">{t(`cockpit.landing.status.${state}`)}</span>
  )
}

/** The landing's words for an engine's row, from its live health. */
export function useEngineRowWords(health: RowHealth): { kind: EngineStatusKind; words: string } {
  const t = useT()
  const kind = engineRowKind(health)
  return { kind, words: engineRowWords(kind, health, t) }
}
