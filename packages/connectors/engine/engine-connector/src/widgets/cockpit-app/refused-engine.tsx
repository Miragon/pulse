import { useCallback, useSyncExternalStore, type ReactNode } from "react"
import {
  isPermanentError,
  useQueryClient,
  useToolQuery,
  ViewDataState,
} from "@miragon/pulse-widget-shell/widgets"
import type { EngineHealthData } from "../../view-models.js"
import { ENGINE_HEALTH_DATA } from "../../tool-names.js"
import { useT } from "../../messages/use-t.js"

/** The engine's health feed, the read the landing's row, the overview and the gate share. */
const HEALTH = "engine:health"
const healthKey = (engine: string) => [HEALTH, engine] as const

/** Its last read failed with the server's refusal: it holds until the operator fixes the profile. */
function isRefusal(state: { status: string; error: unknown } | undefined): boolean {
  return state?.status === "error" && isPermanentError(state.error)
}

/**
 * Whether the engine's health read met the server's refusal of its profile, read from the view's
 * cache without a read of its own: the landing's row or a section may have met it before the
 * engine list answered, or the list failed. Null: no engine is open.
 */
export function useProfileRefusal(engine: string | null): boolean {
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
  const read = () =>
    engine !== null && isRefusal(client.getQueryState([...healthKey(engine), { engine }]))
  return useSyncExternalStore(subscribe, read, read)
}

/**
 * An engine whose profile the server refused (the engine list's `refused`, or a health read that
 * met the refusal, `useProfileRefusal`) is the view's ONE state: every section of every route would
 * fail alike, so none mounts. The words are the server's answer on the health feed; it is never
 * retried, a cached one is not read again on mount, and it offers neither Try again nor the chat,
 * since only the operator can fix the profile. The cockpit's Refresh reads it again, and an engine
 * that answers gets its view back.
 */
export function RefusedEngineGate({
  engine,
  refused,
  children,
}: {
  engine: string
  refused: boolean
  children: ReactNode
}) {
  return refused ? <RefusedEngine engine={engine}>{children}</RefusedEngine> : children
}

function RefusedEngine({ engine, children }: { engine: string; children: ReactNode }) {
  const t = useT()
  const health = useToolQuery<EngineHealthData>(
    healthKey(engine),
    ENGINE_HEALTH_DATA,
    { engine },
    { retryOnMount: false },
  )
  if (health.data && !isRefusal(health)) return children
  return (
    <ViewDataState
      loading={!health.isError}
      error={health.error}
      onRetry={() => void health.refetch()}
      loadingText={t("engineHealth.loading")}
      emptyText={t("engineHealth.noData")}
    />
  )
}
