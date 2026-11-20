import type { ReactNode } from "react"
import type { ProcessFilterData } from "@miragon/pulse-screens"
import { ViewBarSlots } from "@miragon/pulse-ui"
import { useEngineList, type ListedEngines } from "../../engine-list.js"
import { PAGE_MENU } from "../../frame/drawer.js"
import { hasEngineScreen } from "../../frame/nav-sections.js"
import type { Navigate } from "../../router/page-link.js"
import { EngineScreen } from "./engine-screen.js"

/** What the page shows at an engine's own address. */
type Shown = "screen" | "fallback" | "deciding"

/**
 * Whether the page's engine screen serves `engine`: an engine the list names whose dialect has
 * the screen on the web (Camunda 7's), and, where the list could not be read, the screen, which
 * words a refusal itself. An engine of another dialect (shown on boards only), a refused profile
 * and an engine the server does not configure keep the cockpit's one state, as the frame showed
 * them before the screen: the list names each, so the screen never reads one of them.
 */
function shownFor(engine: string, list: ListedEngines | undefined, failed: boolean): Shown {
  if (list === undefined) return failed ? "screen" : "deciding"
  const listed = list.engines?.find(({ id }) => id === engine)
  return listed !== undefined && hasEngineScreen(listed.dialect) ? "screen" : "fallback"
}

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
  const { data, isError } = useEngineList()
  const shown = shownFor(engine, data, isError)
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
