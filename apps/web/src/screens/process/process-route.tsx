import type { ReactNode } from "react"
import type { InstanceListFilterData } from "@miragon/pulse-screens"
import { ViewBarSlots } from "@miragon/pulse-ui"
import { PAGE_MENU } from "../../frame/drawer.js"
import type { Navigate } from "../../router/page-link.js"
import { useScreenShown } from "../screen-shown.js"
import { ProcessScreen, type VersionMove } from "./process-screen.js"

/**
 * A process's own address: the page's process screen where its screens serve the engine, else the
 * cockpit's view the page starts there (`fallback`: an engine shown on boards only or a refused
 * profile with its one state, an engine the server does not configure the tool's refusal). It
 * decides on the frame's one read of the engine list; while that read runs the screen names the
 * process in its bar and reads nothing. The version and the list's filter are the address's.
 */
export function ProcessRoute({
  engine,
  process,
  version,
  filter,
  navigate,
  onFilter,
  onVersion,
  fallback,
}: {
  engine: string
  process: string
  version?: number
  filter: InstanceListFilterData
  navigate: Navigate
  onFilter: (filter: InstanceListFilterData) => void
  onVersion: (version: number, filter: InstanceListFilterData, move: VersionMove) => void
  fallback: ReactNode
}) {
  const shown = useScreenShown(engine)
  if (shown === "fallback") return fallback
  return (
    <ViewBarSlots lead={PAGE_MENU}>
      <ProcessScreen
        engine={engine}
        process={process}
        {...(version === undefined ? {} : { version })}
        filter={filter}
        navigate={navigate}
        onFilter={onFilter}
        onVersion={onVersion}
        ready={shown === "screen"}
      />
    </ViewBarSlots>
  )
}
