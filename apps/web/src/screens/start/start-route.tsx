import { useCallback } from "react"
import { ViewBarSlots } from "@miragon/pulse-ui"
import { PAGE_MENU } from "../../frame/drawer.js"
import type { PageRouter } from "../../router/router.js"
import { StartScreen } from "./start-screen.js"

/**
 * The start page's address, `/app`: the page's start page, the page's menu first in its bar as the
 * frame hands a view its chrome. A row opens its engine or a board in a new entry of the page's
 * history; a server of one engine and no board shows that engine in the start page's entry
 * (`replace`), so Back leads to where the reader came from, without moving the focus: the reader
 * moved nothing, so the skip link stays the first stop (the router's `refine`, which starts the
 * engine's screen there since it is another screen).
 */
export function StartRoute({ router }: { router: PageRouter }) {
  const replace = useCallback((url: string) => router.refine(url, "replace"), [router])
  return (
    <ViewBarSlots lead={PAGE_MENU}>
      <StartScreen navigate={router.navigate} replace={replace} />
    </ViewBarSlots>
  )
}
