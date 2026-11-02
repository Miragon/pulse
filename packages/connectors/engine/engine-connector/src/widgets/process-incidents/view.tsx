import { ViewStack } from "@miragon/pulse-widget-shell/widgets"
import type { DefinitionScope } from "./feed.js"
import { ProcessDetailHeader } from "./header.js"
import { ProcessDefinitionKpi } from "./kpi.js"
import { ProcessDefinitionFlow } from "./flow.js"
import { ActivityIncidentList } from "./list.js"

/**
 * THE process-definition view, the cockpit's process-detail route: header, KPI strip,
 * flow and the activity-grouped incident list. Each part brings its own shell and shares one feed
 * (`useDefinitionData`). `focus` only steers the list's no-incidents rendering.
 */
export function ProcessDefinitionView({
  focus,
  ...scope
}: DefinitionScope & { focus?: "incidents" }) {
  return (
    <ViewStack>
      <ProcessDetailHeader {...scope} />
      <ProcessDefinitionKpi {...scope} />
      <ProcessDefinitionFlow {...scope} />
      <ActivityIncidentList {...scope} emptyVariant={focus === "incidents" ? "siblings" : "note"} />
    </ViewStack>
  )
}
