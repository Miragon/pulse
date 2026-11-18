import { cn, Icon, TONE_DOT, TONE_ICON, type ToneVariant } from "@miragon/pulse-ui"
import {
  Ban,
  CircleDashed,
  KeyRound,
  LoaderCircle,
  Minus,
  Unplug,
  type LucideIcon,
} from "lucide-react"
import {
  HEALTH_FAILURE_TONE,
  healthFailureOf,
  isHealthFailure,
  type HealthFailure,
} from "../lib/health-verdict.js"

/** In words, so colour is never the only signal. */
export type EngineStatusKind =
  | "loading"
  | "notLoaded"
  | HealthFailure
  | "empty"
  | "incidents"
  | "failedJobs"
  | "idle"
  | "healthy"

/**
 * #322 U15, from the same live health as the engine's overview. A profile the server refused and
 * an engine that refused the server's login are states of their own (`healthFailureOf`): the
 * server never asks the one, and the other answered, so neither is unreachable. A page whose
 * session ended asked no engine: the row keeps what it last read, and says it read nothing where
 * it read nothing yet (`notLoaded`, no tone); the page's frame says the session ended.
 */
export function engineStatusKind(health: {
  /** The read's failure, from its first failed attempt (`useEngineHealth`); null without one. */
  failure: Error | null
  summary:
    | {
        totalDefinitions: number
        totalRunningInstances: number
        totalFailedJobs: number
        totalIncidents: number
      }
    | undefined
}): EngineStatusKind {
  const failure = health.failure && healthFailureOf(health.failure)
  if (failure) return failure
  const s = health.summary
  if (!s) return health.failure ? "notLoaded" : "loading"
  if (s.totalDefinitions === 0) return "empty"
  if (s.totalIncidents > 0) return "incidents"
  if (s.totalFailedJobs > 0) return "failedJobs"
  if (s.totalRunningInstances === 0) return "idle"
  return "healthy"
}

/** A refused login is the server's key, whether the engine rejected it (401) or its access (403). */
const FAILURE_ICON: Readonly<Record<HealthFailure, LucideIcon>> = {
  unreachable: Unplug,
  refused: Ban,
  unauthorized: KeyRound,
  forbidden: KeyRound,
}

/**
 * CI §3.7; the dot is the engine's one live verdict, the overview badge's tone, on the landing
 * and in the cross-engine view alike. A failed read has no verdict: its icon of its own shape in
 * `HEALTH_FAILURE_TONE` (an unreachable engine danger) takes the dot's place.
 */
export function StatusMark({ kind, tone }: { kind: EngineStatusKind; tone: ToneVariant }) {
  if (kind === "loading") {
    return <Icon icon={LoaderCircle} className="text-muted-foreground motion-safe:animate-spin" />
  }
  if (isHealthFailure(kind)) {
    return <Icon icon={FAILURE_ICON[kind]} className={TONE_ICON[HEALTH_FAILURE_TONE[kind]]} />
  }
  if (kind === "empty") return <Icon icon={CircleDashed} className="text-muted-foreground" />
  if (kind === "notLoaded") return <Icon icon={Minus} className="text-muted-foreground" />
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden="true">
      <span data-part="verdict" className={cn("size-2 rounded-full", TONE_DOT[tone])} />
    </span>
  )
}
