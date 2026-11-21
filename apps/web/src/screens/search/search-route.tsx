import { useCallback, useMemo } from "react"
import { ViewBarSlots } from "@miragon/pulse-ui"
import { PAGE_MENU } from "../../frame/drawer.js"
import type { PageRouter } from "../../router/router.js"
import { SearchScreen } from "./search-screen.js"

/**
 * The search's address: the page's search across engines, the page's menu first in its bar as the
 * frame hands a view its chrome. A row opens its instance in a new entry of the page's history;
 * exactly one hit takes the search's own entry (`replace`), so Back leads to where it started, once
 * per entry (the router's mark of the entry it decided on, `seen`), so a return never leaves it.
 */
export function SearchRoute({ text, router }: { text: string; router: PageRouter }) {
  const replace = useCallback((url: string) => router.navigate(url, "replace"), [router])
  const entry = useMemo(() => ({ seen: router.seen, markSeen: router.markSeen }), [router])
  return (
    <ViewBarSlots lead={PAGE_MENU}>
      <SearchScreen text={text} navigate={router.navigate} replace={replace} entry={entry} />
    </ViewBarSlots>
  )
}
