import type { Client } from "@miragon/pulse-camunda7-client"
import { MAX_PAGE_SIZE } from "@miragon/pulse-camunda7-client/schemas"
import {
  getHistoricActivityInstances,
  getHistoricActivityInstancesCount,
  getHistoricProcessInstances,
  getIncidents,
} from "@miragon/pulse-camunda7-client/sdk"
import { collectIncidentActivityIds } from "../lib/activity-tree.js"
import type { HistoryTimelineData } from "../view-models.js"
import type { PagingArgs } from "../feed-contracts.js"
import { nameUnnamedDefinitions } from "./definition-info.js"
import { countOf, optional, rowsOf } from "./engine-reads.js"

const INCIDENT_MARKS = 100

/** All three reads are primary: a failed count is never the page length passed off as a total. */
export async function buildHistoryTimelineData(
  client: Client,
  engineId: string,
  args: { processInstanceId: string } & PagingArgs,
): Promise<HistoryTimelineData> {
  const { processInstanceId } = args
  const [activities, totalActivities, instances, incidents] = await Promise.all([
    getHistoricActivityInstances({
      client,
      query: {
        processInstanceId,
        sortBy: "startTime",
        sortOrder: "asc",
        firstResult: args.firstResult,
        maxResults: args.maxResults ?? MAX_PAGE_SIZE,
      },
    }).then((rows) => rowsOf<HistoryTimelineData["activities"][number]>(rows)),
    getHistoricActivityInstancesCount({ client, query: { processInstanceId } }).then(countOf),
    getHistoricProcessInstances({ client, query: { processInstanceId, maxResults: 1 } }).then(
      (rows) => rowsOf<NonNullable<HistoryTimelineData["processInstance"]>>(rows),
    ),
    // Enrichment: unread, no marks.
    optional(
      getIncidents({ client, query: { processInstanceId, maxResults: INCIDENT_MARKS } }).then(
        (rows) => rowsOf<{ activityId?: string | null }>(rows),
      ),
    ),
  ])
  return {
    processInstance: await namedInstance(client, instances[0] ?? null),
    activities,
    totalActivities,
    incidentActivityIds: incidents ? collectIncidentActivityIds(incidents) : null,
    engineId,
  }
}

type HistoricInstance = NonNullable<HistoryTimelineData["processInstance"]>

async function namedInstance(
  client: Client,
  instance: HistoricInstance | null,
): Promise<HistoricInstance | null> {
  if (!instance || instance.processDefinitionName) return instance
  // The engine's row carries the version id the view model leaves out.
  const { processDefinitionId } = instance as { processDefinitionId?: string | null }
  const [definition] = await nameUnnamedDefinitions(client, [
    {
      id: processDefinitionId,
      key: instance.processDefinitionKey,
      name: instance.processDefinitionName,
    },
  ])
  return { ...instance, processDefinitionName: definition.name ?? null }
}
