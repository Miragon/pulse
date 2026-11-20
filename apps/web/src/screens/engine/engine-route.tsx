import type { ReactNode } from "react"
import type { ProcessFilterData } from "@miragon/pulse-screens"
import { ViewBarSlots } from "@miragon/pulse-ui"
import { PAGE_MENU } from "../../frame/drawer.js"
import type { Navigate } from "../../router/page-link.js"
import { useScreenShown } from "../screen-shown.js"
import { EngineScreen } from "./engine-screen.js"

/**
 * The engine's own address: the page's engine screen where it serves the engine, else the
 * cockpit's view the page starts there (`fallback`: an engine shown on boards only or a refused
 * profile with its one state under a bar of its own, an engine the server does not configure the
 * page's refused start). It decides on the frame's one read of the engine list, which the
 * navigation and the cockpit share; while that read runs the screen names the engine in its bar and
 * reads nothing. The screen's filter is the address's (`filter`, `onFilter`).
 */
export function EngineRoute({
  engine,
  navigate,
  filter,
  onFilter,
  fallback,
}: {
  engine: string
  navigate: Navigate
  filter: ProcessFilterData
  onFilter: (filter: ProcessFilterData) => void
  fallback: ReactNode
}) {
  const shown = useScreenShown(engine)
  if (shown === "fallback") return fallback
  // The page's menu first in the screen's bar, as the frame hands a view its chrome; while the list
  // is read the screen names the engine and reads nothing yet.
  return (
    <ViewBarSlots lead={PAGE_MENU}>
      <EngineScreen
        engine={engine}
        navigate={navigate}
        filter={filter}
        onFilter={onFilter}
        ready={shown === "screen"}
      />
    </ViewBarSlots>
  )
}
