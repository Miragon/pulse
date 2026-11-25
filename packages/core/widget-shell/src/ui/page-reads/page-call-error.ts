import type { PageErrorCode } from "@miragon/pulse-ui"

/** Where a refused call went: the tool it called and the connection that refused it. */
export interface PageCallSite {
  readonly tool?: string
  readonly connector?: string
}

/**
 * A call the page's transport refused before a tool answered, in pulse-ui's page error words
 * (`PageErrorCode`): an artifact runtime's refusals, say. It is pulse-ui's `PageError` in shape, so
 * `describePageError` words it; its message is the raw text, which only "Details" shows. A tool's
 * own failure is no refusal: the caller resolves it as an `isError` answer.
 */
export class PageCallError extends Error {
  readonly code: PageErrorCode
  /** The raw text behind it, shown under "Details". */
  readonly detail: string
  /** The tool the call named. */
  readonly tool: string | undefined
  /** The connection that refused it, by the name the page knows it under, which its words name. */
  readonly connector: string | undefined

  constructor(code: PageErrorCode, detail: string, at: PageCallSite = {}) {
    super(detail)
    this.name = "PageCallError"
    this.code = code
    this.detail = detail
    this.tool = at.tool
    this.connector = at.connector
  }
}

/** The refusals of a connection as a whole: no sign-in, no connection, no approval. */
const PAGE_WIDE: ReadonlySet<PageErrorCode> = new Set([
  "needs_reauth",
  "not_connected",
  "approval_required",
])

/**
 * A refusal of the page's connection as a whole: no read of it passes then, so one state says it
 * for the page (`PageGate`). `not_allowed` is none: it refuses one tool, for good.
 */
export function isPageWideRefusal(error: unknown): error is PageCallError {
  return error instanceof PageCallError && PAGE_WIDE.has(error.code)
}

/**
 * A refusal no retry of the moment changes, which a section's read never retries by itself: every
 * code but `unavailable` (the connection does not answer) and `tool_error` (the server's own
 * failure, which the view's rules for the server's errors retry or not).
 */
export function isPageRefusal(error: unknown): boolean {
  return (
    error instanceof PageCallError && error.code !== "unavailable" && error.code !== "tool_error"
  )
}
