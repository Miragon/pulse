import { createContext, useContext } from "react"
import {
  buildShowWidgetIntent,
  useHostActions,
  type HostActions,
} from "@miragon/mcp-toolkit-ui/app"
import { SHELL_SHOW_SETTINGS } from "@miragon/pulse-widget-shell/widgets"
import {
  CAMUNDA7_SHOW_CLUSTER_DETAIL,
  CAMUNDA7_SHOW_ENGINE_HEALTH,
  CAMUNDA7_SHOW_INCIDENT_DETAIL,
  CAMUNDA7_SHOW_INCIDENTS_DASHBOARD,
  CAMUNDA7_SHOW_INSTANCE_DETAIL,
  CAMUNDA7_SHOW_PROCESS_DETAIL,
  CAMUNDA7_SHOW_PROCESS_INCIDENTS,
  CAMUNDA7_SHOW_PROCESS_INSTANCES,
  CAMUNDA7_SHOW_PROCESS_LIST,
} from "../tool-names.js"

// Standalone widgets bind this to `navigateViaHost` (a chat follow-up), the cockpit to its
// client-side router, so the cockpit navigates without an LLM round-trip.
export type NavIntent =
  | { type: "overview" }
  | { type: "process-list" }
  | { type: "incidents" }
  | { type: "settings" }
  | ({
      type: "cluster-detail"
      activityId: string
      incidentType: string
      messageSignature?: string
    } & Labelled)
  | ({ type: "process-detail"; processDefinitionKey: string } & Labelled)
  | { type: "process-instances"; processDefinitionKey?: string }
  | ({ type: "process-incidents"; processDefinitionKey: string } & Labelled)
  | ({ type: "instance-detail"; processInstanceId: string } & Labelled)
  | ({ type: "incident-detail"; incidentId: string } & Labelled)

// #322 U13: the breadcrumb name; without one the drill shows the id.
interface Labelled {
  label?: string
}

export type OnNavigate = (intent: NavIntent) => void

export function navigateViaHost(host: HostActions, intent: NavIntent): void {
  switch (intent.type) {
    case "overview":
      host.showWidget(
        buildShowWidgetIntent(CAMUNDA7_SHOW_ENGINE_HEALTH, "Show the engine overview"),
      )
      return
    case "process-list":
      host.showWidget(
        buildShowWidgetIntent(CAMUNDA7_SHOW_PROCESS_LIST, "Show all process definitions"),
      )
      return
    case "incidents":
      host.showWidget(
        buildShowWidgetIntent(
          CAMUNDA7_SHOW_INCIDENTS_DASHBOARD,
          "Show the incidents dashboard across all processes",
        ),
      )
      return
    case "settings":
      host.showWidget(buildShowWidgetIntent(SHELL_SHOW_SETTINGS, "Open my settings"))
      return
    case "cluster-detail":
      host.showWidget(
        buildShowWidgetIntent(
          CAMUNDA7_SHOW_CLUSTER_DETAIL,
          // The signature narrows the cluster to one failure (#344 N115).
          `Show the failure cluster for activity \`${intent.activityId}\` (incident type ${intent.incidentType}${intent.messageSignature ? `, message signature \`${intent.messageSignature}\`` : ""})`,
        ),
      )
      return
    case "process-detail":
      host.showWidget(
        buildShowWidgetIntent(
          CAMUNDA7_SHOW_PROCESS_DETAIL,
          `Show the process detail for \`${intent.processDefinitionKey}\``,
        ),
      )
      return
    case "process-instances":
      host.showWidget(
        buildShowWidgetIntent(
          CAMUNDA7_SHOW_PROCESS_INSTANCES,
          intent.processDefinitionKey
            ? `Show the running instances for process \`${intent.processDefinitionKey}\``
            : "Show all running process instances across all definitions",
        ),
      )
      return
    case "process-incidents":
      host.showWidget(
        buildShowWidgetIntent(
          CAMUNDA7_SHOW_PROCESS_INCIDENTS,
          `Show all incidents for process \`${intent.processDefinitionKey}\``,
        ),
      )
      return
    case "instance-detail":
      host.showWidget(
        buildShowWidgetIntent(
          CAMUNDA7_SHOW_INSTANCE_DETAIL,
          `Show the instance detail for \`${intent.processInstanceId}\``,
        ),
      )
      return
    case "incident-detail":
      host.showWidget(
        buildShowWidgetIntent(
          CAMUNDA7_SHOW_INCIDENT_DETAIL,
          `Analyze incident \`${intent.incidentId}\` in detail`,
        ),
      )
      return
  }
  // Exhaustive: a new variant fails to compile instead of no-oping.
  return intent satisfies never
}

// Without a provider `useNav` falls back to the host bridge, so the cockpit renders widgets
// generically without threading an `onNavigate` prop.
const NavContext = createContext<OnNavigate | null>(null)
export const NavProvider = NavContext.Provider

export function useNav(): OnNavigate {
  const fromCockpit = useContext(NavContext)
  const host = useHostActions()
  return fromCockpit ?? ((intent) => navigateViaHost(host, intent))
}
