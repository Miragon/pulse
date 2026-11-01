import { ViewStack } from "@miragon/pulse-widget-shell/widgets"
import type { ProcessIncidentsData } from "../../view-models.js"
import { ProcessDetailHeader } from "./header.js"
import { ProcessDefinitionKpi } from "./kpi.js"
import { ProcessDefinitionFlow } from "./flow.js"
import { ActivityIncidentList } from "./list.js"

/**
 * THE process-definition view, for the two show tools and the cockpit route: header, KPI strip,
 * flow and the activity-grouped incident list. Each part brings its own shell and shares one feed
 * (`useDefinitionData`). `focus` only steers the list's no-incidents rendering.
 */
export function ProcessDefinitionView({
  data = null,
  processDefinitionKey,
  engine,
  focus,
}: {
  data?: ProcessIncidentsData | null
  processDefinitionKey?: string
  engine?: string
  focus?: "incidents"
}) {
  const scope = { data, processDefinitionKey, engine }
  return (
    <ViewStack>
      <ProcessDetailHeader {...scope} />
      <ProcessDefinitionKpi {...scope} />
      <ProcessDefinitionFlow {...scope} />
      <ActivityIncidentList {...scope} emptyVariant={focus === "incidents" ? "siblings" : "note"} />
    </ViewStack>
  )
}
