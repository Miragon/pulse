import { describePageError, resolveUiMessages, type SectionFailure } from "@miragon/pulse-ui"
import { describeError, isPermanentError } from "../describe-error.js"
import { resolveLanguage } from "../host-context.js"
import type { PageHints } from "../page-hints.js"
import type { FollowUp } from "../view-host.js"
import { PageCallError } from "./page-call-error.js"

export interface DescribePageFailureOptions {
  /** What a hand-off does where the page sits (`ViewHost.followUp`); default `none`, a page's. */
  readonly followUp?: FollowUp
  /**
   * The page's words of what to do (`ViewHost.pageHints`), its `connectionPlace` the place a
   * refused connection's words name.
   */
  readonly pageHints?: PageHints | undefined
}

/**
 * A page's failed read in words, as pulse-ui's `SectionState` and `ErrorState` show it: a refusal
 * of the transport (`PageCallError`) in the kit's page error words (`describePageError`) with the
 * connection's name and the place its viewer manages it (`connectionPlace`); the server's errors (a
 * tool's `isError` answer, a `tool_error` refusal by its text) and any other failure classified by
 * `describeError` with the page's hints. Never the raw text as the title: it shows under
 * "Details" only. `permanent` where Try again cannot help.
 */
export function describePageFailure(
  error: unknown,
  locale: string | undefined,
  { followUp = "none", pageHints }: DescribePageFailureOptions = {},
): SectionFailure {
  if (error instanceof PageCallError && error.code !== "tool_error") {
    return describePageError(error, {
      messages: resolveUiMessages(locale),
      connector: error.connector,
      place: pageHints?.[resolveLanguage(locale)].connectionPlace,
    })
  }
  const cause = error instanceof PageCallError ? error.detail : error
  const described = describeError(cause, locale, { followUp, pageHints })
  return {
    title: described.title,
    hint: described.hint,
    ...(described.details === null ? {} : { details: described.details }),
    ...(isPermanentError(cause) ? { permanent: true } : {}),
  }
}
