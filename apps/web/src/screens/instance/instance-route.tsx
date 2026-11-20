import type { ReactNode } from "react"
import { ViewBarSlots } from "@miragon/pulse-ui"
import { PAGE_MENU } from "../../frame/drawer.js"
import type { Navigate } from "../../router/page-link.js"
import type { InstanceTab } from "../../router/routes.js"
import { useScreenShown } from "../screen-shown.js"
import { IncidentResolve } from "./incident-resolve.js"
import { InstanceScreen } from "./instance-screen.js"

/**
 * An instance's own address, and an incident's under it: the page's instance screen where its
 * screens serve the engine, else the cockpit's view the page starts there (`fallback`: an engine
 * shown on boards only or a refused profile with its one state, an engine the server does not
 * configure the tool's refusal). It decides on the frame's one read of the engine list; while that
 * read runs the screen names the instance in its bar and reads nothing. The tab is the address's
 * (`tab`, `onTab`).
 */
export function InstanceRoute({
  engine,
  instance,
  tab,
  incident,
  navigate,
  onTab,
  fallback,
}: {
  engine: string
  instance: string
  tab?: InstanceTab
  incident?: string
  navigate: Navigate
  onTab: (tab: InstanceTab) => void
  fallback: ReactNode
}) {
  const shown = useScreenShown(engine)
  if (shown === "fallback") return fallback
  return (
    <ViewBarSlots lead={PAGE_MENU}>
      <InstanceScreen
        engine={engine}
        instance={instance}
        {...(tab === undefined ? {} : { tab })}
        {...(incident === undefined ? {} : { incident })}
        navigate={navigate}
        onTab={onTab}
        ready={shown === "screen"}
      />
    </ViewBarSlots>
  )
}

/**
 * An incident the page knows by its id alone (a drill of the cockpit to one, an old address of one):
 * the page leads on to the instance that holds its root, else the cockpit's view (an engine the
 * page's screens do not serve).
 */
export function IncidentRoute({
  engine,
  incident,
  navigate,
  fallback,
}: {
  engine: string
  incident: string
  navigate: (url: string, entry?: "push" | "replace") => void
  fallback: ReactNode
}) {
  const shown = useScreenShown(engine)
  if (shown === "fallback") return fallback
  return (
    <ViewBarSlots lead={PAGE_MENU}>
      <IncidentResolve
        engine={engine}
        incident={incident}
        navigate={navigate}
        ready={shown === "screen"}
      />
    </ViewBarSlots>
  )
}
