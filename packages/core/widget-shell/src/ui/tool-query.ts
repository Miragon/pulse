/**
 * The view's data layer: TanStack Query over the view host's `callTool`. ONE client per view
 * document (`ViewRoot`), keys `[...key, args]`, so a write invalidates by key prefix (the engine module's
 * `WRITE_POLICY`) and every reader of that prefix refetches.
 */
import { useCallback, useState } from "react"
import {
  hashKey,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query"
import { decodeToolResult } from "../protocol/tool-result.js"
import { useViewHost } from "./view-host.js"

export { useQueryClient, type QueryClient } from "@tanstack/react-query"

/** Reads stay fresh for 30 s; TanStack's default retry (3) rides out a transient failure. */
export function createViewQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  })
}

/** TanStack's query options; the key and the fetcher come from the tool and its args. */
export type ToolQueryOptions<TData> = Omit<
  UseQueryOptions<TData, Error, TData>,
  "queryKey" | "queryFn"
>

/** Reads `tool` with `args`; the cache key is `[...key, args]`. An `isError` answer fails the query. */
export function useToolQuery<TData>(
  key: readonly unknown[],
  tool: string,
  args: object,
  options?: ToolQueryOptions<TData>,
): UseQueryResult<TData, Error> {
  const { callTool } = useViewHost()
  return useQuery<TData, Error, TData>({
    ...options,
    queryKey: [...key, args],
    queryFn: async () => decodeToolResult<TData>(await callTool(tool, args)),
  })
}

export interface ToolMutationOptions {
  /** Query key prefixes to invalidate after a successful call (active readers refetch). */
  invalidateKeys?: readonly (readonly unknown[])[]
}

/** Calls `tool` as a write; on success it invalidates `invalidateKeys` before resolving. */
export function useToolMutation<TData = unknown, TArgs extends object = Record<string, unknown>>(
  tool: string,
  options?: ToolMutationOptions,
): UseMutationResult<TData, Error, TArgs> {
  const { callTool } = useViewHost()
  const client = useQueryClient()
  const keys = options?.invalidateKeys
  return useMutation<TData, Error, TArgs>({
    mutationFn: async (args) => decodeToolResult<TData>(await callTool(tool, args)),
    onSuccess: async () => {
      if (!keys) return
      await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })))
    },
  })
}

export interface ViewDataOptions<T> {
  /** An extra gate next to `ready`. */
  enabled?: boolean
  placeholderData?: ToolQueryOptions<T>["placeholderData"]
}

export interface ViewDataResult<T> {
  data: T | null
  /** No data yet and the feed is fetching: the first paint of a self-fetching widget. */
  loading: boolean
  error: Error | null
  /** A new read at once, also while a failed fetch waits on its retry backoff. */
  refetch: () => void
  failureCount: number
  /** Set from the first failed attempt, while the query still retries. */
  failureReason: Error | null
  isFetching: boolean
  /** `data` is the previous args' answer while the current args' fetch runs or failed. */
  isPlaceholderData: boolean
}

/**
 * One widget serves a standalone view and a self-fetching page. The show tool's data SEEDS the
 * feed's cache entry, and the query stays live once `ready`: a write's invalidation, a retry or a
 * refresh re-reads the feed. Embedded (no `initialData`) it fetches `tool` with `args` under `key`.
 * A remounted old payload never rolls a refetched answer back; a new delivery replaces it.
 */
export function useViewData<T>(
  initialData: T | null | undefined,
  key: readonly unknown[],
  tool: string,
  args: object,
  ready: boolean,
  options: ViewDataOptions<T> = {},
): ViewDataResult<T> {
  const cacheKey = useStableKey([...key, args])
  useSeed(initialData, cacheKey)
  const query = useToolQuery<T>(key, tool, args, {
    placeholderData: options.placeholderData,
    enabled: ready && options.enabled !== false,
  })
  const data = query.data ?? initialData ?? null
  const refetch = useFreshRefetch(cacheKey, query.refetch)
  return {
    data,
    loading: !data && query.isEnabled && !query.isError,
    error: query.error,
    refetch,
    failureCount: query.failureCount,
    failureReason: query.failureReason,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
  }
}

/** `key`, kept by content: callers build `key`/`args` anew every render. */
function useStableKey(key: unknown[]): unknown[] {
  const id = hashKey(key)
  const [stable, setStable] = useState({ id, key })
  if (stable.id !== id) setStable({ id, key })
  return stable.id === id ? stable.key : key
}

/** The content last seeded per key and client: an old payload must not win over a refetch. */
const lastSeeded = new WeakMap<QueryClient, Map<string, string>>()

function contentOf(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

/** Written when the entry is empty, or when `seed` is content this client never seeded for the key. */
function seedToolQuery(client: QueryClient, queryKey: readonly unknown[], seed: unknown): boolean {
  const keyId = hashKey(queryKey)
  const seeded = lastSeeded.get(client) ?? new Map<string, string>()
  lastSeeded.set(client, seeded)
  const content = contentOf(seed)
  const delivered = content === undefined || seeded.get(keyId) !== content
  if (content !== undefined) seeded.set(keyId, content)
  if (!delivered && client.getQueryData(queryKey) !== undefined) return false
  client.setQueryData(queryKey, seed)
  return true
}

/**
 * Seeds in the render phase, before the query's observer reads the cache, as TanStack's own
 * `initialData` does. The last processed seed skips the content check while the same object
 * comes in render after render.
 */
function useSeed(seed: unknown, cacheKey: unknown[]): void {
  const client = useQueryClient()
  const keyId = hashKey(cacheKey)
  const [seen, setSeen] = useState<{ seed: unknown; keyId: string } | null>(null)
  if (seed == null || (seen?.seed === seed && seen.keyId === keyId)) return
  const written = seedToolQuery(client, cacheKey, seed)
  // Only a real change re-renders: an equal new object per render must not loop.
  if (written || seen?.keyId !== keyId) setSeen({ seed, keyId })
}

/**
 * TanStack restarts an in-flight fetch only over data; a key without data joins the running
 * retry chain and waits out its backoff. So cancel that chain first, then read.
 */
function useFreshRefetch(cacheKey: unknown[], refetchQuery: () => Promise<unknown>): () => void {
  const client = useQueryClient()
  return useCallback(() => {
    if (client.getQueryData(cacheKey) !== undefined) {
      void refetchQuery()
      return
    }
    void client.cancelQueries({ queryKey: cacheKey, exact: true }).then(() => refetchQuery())
  }, [client, cacheKey, refetchQuery])
}
