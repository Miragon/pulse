import type { PageErrorMessages, PageErrorParams, UiMessages } from "./message-types.js"

/**
 * The page error vocabulary: why a call of a page outside a host gave no data, as one code per
 * reason, so a page maps its transport's errors once (a claude.ai artifact its runtime's
 * refusals, a page of your own its fetch) and the kit words them the same everywhere.
 *
 * - `needs_reauth`: the sign-in of the page's connection ran out, the viewer has to reconnect
 * - `not_connected`: the viewer has no connection of the name the page calls, or has to pick one
 * - `not_allowed`: the page may not call the tool it needs (its declared tools leave it out, or
 *   a policy of the viewer's organization blocks it); no retry changes that
 * - `approval_required`: the viewer has not approved the page's access yet
 * - `unavailable`: the connection or the server does not answer
 * - `tool_error`: the call reached the server and failed there, the engine's error or the tool's
 *   own; a page that can classify the server's text (widget-shell's `describeError`) words it
 *   with that instead
 */
export type PageErrorCode =
  | "needs_reauth"
  | "not_connected"
  | "not_allowed"
  | "approval_required"
  | "unavailable"
  | "tool_error"

/** Every {@link PageErrorCode}, in the order of its type. */
export const PAGE_ERROR_CODES: readonly PageErrorCode[] = [
  "needs_reauth",
  "not_connected",
  "not_allowed",
  "approval_required",
  "unavailable",
  "tool_error",
]

/** A failed call of a page: its code and the raw text behind it, shown under "Details". */
export interface PageError {
  readonly code: PageErrorCode
  /** The raw text of the failure (the transport's message, the server's error text). */
  readonly detail?: string | null
}

/**
 * A failure in words, as `SectionState` and a page's own `ErrorState` show it: what happened,
 * what you can do, the raw text for "Details" and whether a retry can help.
 */
export interface SectionFailure {
  /** What happened, in plain words; never the raw text. */
  readonly title: string
  /** What you can do. */
  readonly hint?: string
  /** The raw reason, collapsed under "Details". */
  readonly details?: string
  /** A refusal no retry changes: its state offers no Try again, its hint names the way out. */
  readonly permanent?: boolean
}

/** What `describePageError` words a failure with: the catalog, the transport's name and place. */
export interface DescribePageErrorOptions {
  /**
   * The kit's catalog in the viewer's language: `useUiMessages()` in a component,
   * `resolveUiMessages(locale)` outside one.
   */
  readonly messages: UiMessages
  /** What the page calls its way to Pulse, the name of the viewer's connector. Default "Pulse". */
  readonly connector?: string
  /**
   * Where the viewer manages that connection, a phrase the hint puts after its name as it is
   * ("in claude.ai, in Settings under Connectors"). Default: none, the hint names no place.
   */
  readonly place?: string
}

/** The name a page's connection goes by unless the page names its own. */
const DEFAULT_CONNECTOR = "Pulse"

/** Each code's title and hint in the catalog. */
const WORDS: Readonly<
  Record<PageErrorCode, readonly [keyof PageErrorMessages, keyof PageErrorMessages]>
> = {
  needs_reauth: ["needsReauth", "needsReauthHint"],
  not_connected: ["notConnected", "notConnectedHint"],
  not_allowed: ["notAllowed", "notAllowedHint"],
  approval_required: ["approvalRequired", "approvalRequiredHint"],
  unavailable: ["unavailable", "unavailableHint"],
  tool_error: ["toolError", "toolErrorHint"],
}

/** The codes no retry changes: the page's declared tools or a policy decide, not the moment. */
const PERMANENT: ReadonlySet<PageErrorCode> = new Set(["not_allowed"])

/**
 * A page's failed call in the kit's words: what happened and what you can do per code, the raw
 * text only under "Details", and `permanent` where Try again cannot help. A code the type does
 * not know (an untyped transport) is worded as `tool_error`, never thrown.
 */
export function describePageError(
  error: PageError,
  { messages, connector, place }: DescribePageErrorOptions,
): SectionFailure {
  const code: PageErrorCode = Object.hasOwn(WORDS, error.code) ? error.code : "tool_error"
  const [title, hint] = WORDS[code]
  const params: PageErrorParams = { connector: connector ?? DEFAULT_CONNECTOR, place }
  const details = error.detail?.trim()
  return {
    title: messages.pageError[title](params),
    hint: messages.pageError[hint](params),
    ...(details ? { details } : {}),
    ...(PERMANENT.has(code) ? { permanent: true } : {}),
  }
}
