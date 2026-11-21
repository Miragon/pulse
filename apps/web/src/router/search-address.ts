import { PAGES } from "../pages.js"

/** The search's place: the page's own, which no view of the cockpit reports or claims. */
export const SEARCH_VIEW = "search"

/**
 * The most characters a search's text has, trimmed: the search's feed takes no longer one
 * (`engine_screen_find_data`'s `text`, which `test/search-limits.test.ts` holds this to), and no
 * engine assigns a longer id.
 */
export const SEARCH_TEXT_MOST = 256

/** The query parameter of what the search searches. */
const SEARCH_QUERY = "q"

/** What the search's address searches (its query's `q`), trimmed; none without one. */
export function searchedIn(search: string): string {
  return (new URLSearchParams(search).get(SEARCH_QUERY) ?? "").trim()
}

/** The search's address for `text`, trimmed: `/app/search?q=…`, or `/app/search` for none. */
export function searchUrlOf(text: string): string {
  const wanted = text.trim()
  return wanted === ""
    ? PAGES.search
    : `${PAGES.search}?${new URLSearchParams([[SEARCH_QUERY, wanted]]).toString()}`
}
