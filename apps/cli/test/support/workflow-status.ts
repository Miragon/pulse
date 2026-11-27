/** c7-core's incident grouping as `pulse status` prints it, for the status tests. */

import { definitionStatisticsOf, type Rec } from "@miragon/pulse-c7-core"
import { groupIncidents as groupedBy } from "@miragon/pulse-c7-core/testing"
import { groupOrder, renderGroup } from "../../src/workflow/status-command.js"

/**
 * The incident groups in the CLI's order, each with its next step as a command line, over the
 * definition statistics as the engine answers them (read by c7-core's one parse).
 */
export function groupIncidents(
  incidents: readonly Rec[],
  statistics: readonly unknown[],
  batchJobDefinitions?: ReadonlySet<string>,
) {
  const rows = definitionStatisticsOf(statistics)
  const grouped = groupedBy(incidents, rows, batchJobDefinitions, groupOrder)
  return { ...grouped, groups: grouped.groups.map((group) => renderGroup(group)) }
}
