import type { EngineVerdict } from "@miragon/pulse-blocks"
import { healthFailureOf } from "@miragon/pulse-engine-connector/widgets"

/**
 * The verdict feed (the engine module's `SCREEN_FEEDS`): a Camunda 7 engine's live verdict, `ok`,
 * `warning` or `critical`, c7-core's over its open root incidents by the server's thresholds,
 * an app-only read the page's forward admits (`test/page-reads.test.ts`). The page reads the
 * verdict and never decides one; the server reads it from the engine screen's list of processes,
 * whose read the two share.
 */
export const ENGINE_VERDICT_FEED = "engine_screen_verdict_data"

/**
 * The dialects whose engines the server decides a verdict for, the verdict feed's mark: Camunda
 * 7's alone (`test/nav-sections.test.tsx` holds it to the feeds the server registers per dialect).
 * A Camunda 8 engine shows none.
 */
const VERDICT_DIALECTS: readonly string[] = ["c7"]

/** Whether the server decides a verdict for an engine of `dialect`. */
export const hasVerdict = (dialect: string | undefined): boolean =>
  dialect !== undefined && VERDICT_DIALECTS.includes(dialect)

/** An engine's verdict cache key: one read its screen's bar and the start page share. */
export const engineVerdictKey = (engine: string): readonly unknown[] => [
  "web:engine-verdict",
  engine,
]

/** What the verdict feed answers. */
export interface EngineVerdictFeed {
  readonly status: "ok" | "warning" | "critical"
}

/** What an engine's state takes of its verdict's read: TanStack's query result. */
interface VerdictQuery {
  readonly data: EngineVerdictFeed | undefined
  readonly error: Error | null
  readonly failureReason: Error | null
}

/**
 * An engine's live state from its verdict's read: none where the server decides no verdict for
 * the engine, the failure of its last read (a failed read has no verdict, never the one read before:
 * the engine module's words of a failed read, `healthFailureOf`; a page's ended session reads
 * nothing of the engine, quietly), the verdict, the failure of its first attempt while the query
 * client retries behind it, else still reading.
 */
export function verdictOf(query: VerdictQuery | undefined, shown: boolean): EngineVerdict {
  if (!shown) return "none"
  if (query === undefined) return "loading"
  if (query.error !== null) return healthFailureOf(query.error) ?? "unread"
  if (query.data !== undefined) return query.data.status
  if (query.failureReason !== null) return healthFailureOf(query.failureReason) ?? "unread"
  return "loading"
}
