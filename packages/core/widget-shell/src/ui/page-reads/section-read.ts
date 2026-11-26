import { useCallback, useContext, useMemo } from "react"
import { useQuery, type QueryClient } from "@tanstack/react-query"
import { getFormatTimeZone, useLocale, type SectionStateValue } from "@miragon/pulse-ui"
import { validTimeZone } from "../host-context.js"
import { useShellHost } from "../shell-host.js"
import { useQueryClient, useStableKey } from "../tool-query.js"
import { useErrorWords, useViewHost } from "../view-host.js"
import { describePageFailure } from "./describe-page-failure.js"
import { isPageRefusal, isPageWideRefusal } from "./page-call-error.js"
import { gateCovers, PageGateContext, type SectionAnswer } from "./page-gate.js"
import { PAGE_READ_TTL_MS, readerOf, SECTION_READS, type PageReader } from "./page-reader.js"

/** One section's read, as pulse-ui's `SectionState` shows it. */
export interface SectionRead<T> {
  /** For `SectionState`'s `state`: the data kept, the failure in words, whether a read runs. */
  readonly state: SectionStateValue<T>
  /** The last good read's data: kept when a later read fails. */
  readonly data: T | undefined
  /** The last read's failure as it was thrown; none after a good read. */
  readonly error: Error | undefined
  /** When the server read the data shown: the oldest `asOf` of its answers, else when it finished. */
  readonly at: Date | undefined
  /** A read runs. */
  readonly loading: boolean
  /** Reads the section again, past every cache: `SectionState`'s `onRetry`. */
  readonly retry: () => void
}

const systemNow = () => new Date()

/** The client's own retry rule, as TanStack reads it (none given: three, as its default). */
function retriesByDefault(client: QueryClient, count: number, error: Error): boolean {
  const retry = client.getDefaultOptions().queries?.retry ?? 3
  if (typeof retry === "function") return retry(count, error)
  if (typeof retry === "number") return count < retry
  return retry
}

/**
 * One section's read of a page: loading, ready or failed on its own, so one failing section never
 * blanks the page, under the page's one query client. `read` makes the section's calls through the
 * reader; `key` names everything `read` depends on besides the reader (the process it shows),
 * since sections with the same key share one read. A transient failure is retried as every view's
 * read is (`unavailable`, an engine that does not answer), a refusal and a permanent error never.
 * A later read that fails keeps the data with the failure beside it. A refusal of a connection as
 * a whole is the gate's to say where a `PageGate` above covers it, never the section's. A read
 * stays in the cache as long as the page (`gcTime: Infinity`): the gate derives its state from the
 * reads and unmounts their sections while a refusal stands, so TanStack's collection of reads no
 * section observes (5 minutes) would open it by itself, read again and fail again.
 */
export function useSectionRead<T>(
  key: readonly unknown[],
  read: (reader: PageReader) => Promise<T>,
): SectionRead<T> {
  const host = useViewHost()
  const shell = useShellHost()
  const client = useQueryClient()
  const locale = useLocale()
  const { followUp, pageHints } = useErrorWords()
  const gate = useContext(PageGateContext)
  const timeZone = validTimeZone(shell.timeZone) ?? getFormatTimeZone()
  const now = host.now ?? systemNow
  const queryKey = useStableKey([...SECTION_READS, ...key])
  const query = useQuery<SectionAnswer<T>, Error>({
    queryKey,
    staleTime: PAGE_READ_TTL_MS,
    gcTime: Infinity,
    networkMode: "always",
    retry: (count, error) => !isPageRefusal(error) && retriesByDefault(client, count, error),
    queryFn: async () => {
      const seen: number[] = []
      const reader = readerOf(host.callTool, client, timeZone, now, (at) => seen.push(at))
      const data = await read(reader)
      return { data, at: seen.length > 0 ? Math.min(...seen) : now().getTime() }
    },
  })
  const error = query.error ?? undefined
  const covered = gate !== null && isPageWideRefusal(error) && gateCovers(gate.connector, error)
  const own = covered ? undefined : error
  const failure = useMemo(
    () =>
      own === undefined ? undefined : describePageFailure(own, locale, { followUp, pageHints }),
    [own, locale, followUp, pageHints],
  )
  const { refetch } = query
  // A read that failed without data would join its own backoff: cancel it, then read.
  const retry = useCallback(() => {
    void client.cancelQueries({ queryKey, exact: true }).then(() => refetch())
  }, [client, queryKey, refetch])
  const answer = query.data
  const at = useMemo(() => (answer === undefined ? undefined : new Date(answer.at)), [answer])
  const data = answer?.data
  const loading = query.isFetching
  return { state: { data, error: failure, loading }, data, error, at, loading, retry }
}
