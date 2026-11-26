import { useCallback, useMemo, useSyncExternalStore, type ReactNode } from "react"
import type { StateHeadingLevel } from "@miragon/pulse-ui"
import {
  describeError,
  useQueryClient,
  ViewDataState,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import { profileRefusalError } from "../../lib/shared/profile-refusal.js"
import { useT } from "../../messages/use-t.js"
import type { CockpitEngine } from "./boards-only.js"

/** The engine's health feed, the read the landing's row and the overview share. */
const HEALTH = "engine:health"

/**
 * The error of a read that met the server's refusal of the engine's profile, which holds until the
 * operator fixes it: never another refusal no retry changes, a page's ended session say.
 */
function refusalIn(state: { status: string; error: unknown } | undefined): Error | null {
  if (state?.status !== "error" || !(state.error instanceof Error)) return null
  return describeError(state.error, undefined).kind === "profileRefused" ? state.error : null
}

/**
 * The refusal the engine's health read met, read from the view's cache without a read of its own,
 * unless the engine list answered after it (`listedAt`, its last answer's time, 0 before one): the
 * landing's row or a section may have met it before the list answered, or the list failed. Once
 * the list answers again, on the cockpit's Refresh say, the list decides. Null: no engine is open,
 * or no read met it since.
 */
function useMetRefusal(engine: string | null, listedAt: number): Error | null {
  const client = useQueryClient()
  // Only a change of that read's state: an observer's own events also come while a view renders.
  const subscribe = useCallback(
    (onChange: () => void) =>
      client.getQueryCache().subscribe(({ type, query }) => {
        // The cache types every query's key as `any`.
        const key: unknown = query.queryKey
        if (type.startsWith("observer") || !Array.isArray(key)) return
        if (key[0] === HEALTH && key[1] === engine) onChange()
      }),
    [client, engine],
  )
  const read = () => {
    const state = engine === null ? undefined : client.getQueryState([HEALTH, engine, { engine }])
    return state !== undefined && state.errorUpdatedAt >= listedAt ? refusalIn(state) : null
  }
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * The open engine's refused profile: the refusal a read met since the engine list last answered
 * (`listedAt`, its `dataUpdatedAt`), else the reason the start data or the engine list names, in
 * the server's own words, so the view says it without a read (a refused profile of another
 * dialect is offered no feed at all). Null for an engine whose profile holds, or none open.
 */
export function useProfileRefusal(
  engine: string | null,
  engines: readonly CockpitEngine[],
  listedAt: number,
): Error | null {
  const met = useMetRefusal(engine, listedAt)
  const reason = engines.find(({ id }) => id === engine)?.refused?.reason
  const named = useMemo(
    () => (engine === null || reason === undefined ? null : profileRefusalError(engine, reason)),
    [engine, reason],
  )
  return met ?? named
}

/**
 * An engine whose profile the server refused (`useProfileRefusal`) is the view's ONE state: every
 * section of every route would fail alike, so none mounts, and the state reads nothing. It offers
 * neither Try again nor the chat, since only the operator can fix the profile. Its title is the
 * route's heading (h1), as a route's view bar's is, or the heading under a bar that holds the h1
 * (`titleAs`, a page with chrome of its own). The cockpit's Refresh reads the engine list again,
 * and an engine it no longer names refused gets its view back, though a read met the refusal
 * before.
 */
export function RefusedEngineGate({
  refusal,
  titleAs = "h1",
  children,
}: {
  refusal: Error | null
  /** The state's title: the route's h1, or the heading under a bar that holds it. */
  titleAs?: StateHeadingLevel
  children: ReactNode
}) {
  return refusal === null ? children : <RefusedEngineState refusal={refusal} titleAs={titleAs} />
}

/** A refusal needs no retry: no Try again shows (`isPermanentError`). */
const NO_RETRY = () => undefined

function RefusedEngineState({ refusal, titleAs }: { refusal: Error; titleAs: StateHeadingLevel }) {
  const t = useT()
  // A shell of its own, the view's one state in the gutter, as a route's content sits.
  return (
    <WidgetShell>
      <ViewDataState
        loading={false}
        error={refusal}
        errorTitleAs={titleAs}
        onRetry={NO_RETRY}
        emptyText={t("engineHealth.noData")}
      />
    </WidgetShell>
  )
}
