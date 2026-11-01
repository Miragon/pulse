import { ViewStack } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitView } from "../nav-core.js"
import { ClusterDetailWidget } from "../cluster-detail.js"
import { ProcessDefinitionsTable } from "../cockpit-dashboard/definitions-table.js"
import { EngineHealthVerdict } from "../engine-health.js"
import { IncidentDetailWidget } from "../incident-detail.js"
import { IncidentsDashboard } from "../incidents-dashboard/view.js"
import { InstanceDetailWidget } from "../instance-detail.js"
import { ProcessDefinitionView } from "../process-incidents/view.js"
import { ProcessInstancesWidget } from "../process-instances/list.js"
import { ProcessListWidget } from "../process-list.js"

/**
 * One cockpit view: self-fetching widgets scoped to `engine`. A new surface adds its section to
 * `CockpitView` and a case here; the exhaustive switch fails to compile until it does.
 */
export function CockpitRoute({ view, engine }: { view: CockpitView; engine: string }) {
  switch (view.section) {
    // The definitions table carries per-definition health; a second KPI grid would duplicate it.
    case "overview":
      return (
        <ViewStack>
          <EngineHealthVerdict data={null} engine={engine} />
          <ProcessDefinitionsTable data={null} engine={engine} />
        </ViewStack>
      )
    case "process-list":
      return <ProcessListWidget data={null} engine={engine} />
    case "incidents":
      return <IncidentsDashboard engine={engine} />
    case "cluster-detail":
      return (
        <ClusterDetailWidget
          data={null}
          engine={engine}
          activityId={view.activityId}
          incidentType={view.incidentType}
          messageSignature={view.messageSignature}
        />
      )
    case "process-detail":
      return (
        <ProcessDefinitionView
          processDefinitionKey={view.processDefinitionKey}
          engine={engine}
          focus={view.focus}
        />
      )
    case "process-instances":
      return (
        <ProcessInstancesWidget
          data={null}
          processDefinitionKey={view.processDefinitionKey}
          engine={engine}
        />
      )
    case "instance-detail":
      return <InstanceDetailWidget processInstanceId={view.processInstanceId} engine={engine} />
    case "incident-detail":
      return <IncidentDetailWidget incidentId={view.incidentId} engine={engine} />
  }
  return view satisfies never
}
