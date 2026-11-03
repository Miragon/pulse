/** engine-core's incident grouping as `pulse status` prints it, for the status tests. */

import type { Rec } from "@miragon/pulse-engine-core"
import { groupIncidents as groupedBy } from "@miragon/pulse-engine-core/testing"
import { groupOrder, renderGroup } from "../../src/workflow/status-command.js"

/** The incident groups in the CLI's order, each with its next step as a command line. */
export function groupIncidents(
  incidents: readonly Rec[],
  statistics: readonly Rec[],
  batchJobDefinitions?: ReadonlySet<string>,
) {
  const grouped = groupedBy(incidents, statistics, batchJobDefinitions, groupOrder)
  return { ...grouped, groups: grouped.groups.map((group) => renderGroup(group)) }
}
