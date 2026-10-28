import {
  incidentRecovery,
  readProcessInstanceVariables,
  type Client,
} from "@miragon/pulse-camunda7-client"
import type { InstanceDetailData, TaskData } from "../view-models.js"
import {
  getActivityInstanceTree,
  getIncidents,
  getIncidentsCount,
  getProcessInstance,
  getTasks,
  getTasksCount,
} from "@miragon/pulse-camunda7-client/sdk"
import { buildTaskFormSchema } from "../tools/task-form.js"
import { collectActiveActivityIds, collectIncidentActivityIds } from "../lib/activity-tree.js"
import { parseBpmnNames } from "@miragon/pulse-widget-shell/server"
import { buildInstanceCockpitUrl } from "../lib/cockpit-url.js"
import type { EngineProvider } from "../engine-provider.js"
import {
  definitionKeyInId,
  definitionVersionFromId,
  fetchDefinitionXml,
  resolveDefinitionKeys,
} from "./definition-info.js"
import { countOf, optional, rowsOf } from "./engine-reads.js"

const INCIDENT_ROWS = 100
const TASK_ROWS = 50

interface RawIncident {
  id?: string | null
  processInstanceId?: string | null
  incidentType?: string | null
  incidentMessage?: string | null
  incidentTimestamp?: string | null
  activityId?: string | null
  configuration?: string | null
}

/** Null when the read fails; the forms are then UNKNOWN. */
async function readBpmnXml(
  client: Client,
  definitionId: string | undefined,
): Promise<{ bpmnXml: string | null; unreadable: boolean }> {
  if (!definitionId) return { bpmnXml: null, unreadable: false }
  try {
    return { bpmnXml: await fetchDefinitionXml(client, definitionId), unreadable: false }
  } catch {
    return { bpmnXml: null, unreadable: true }
  }
}

/** ENRICHMENT, read only when there are links: a failed read is no link, never the UUID as a key. */
async function linkDefinitionKey(
  client: Client,
  definitionId: string | undefined,
  needed: boolean,
): Promise<string | null> {
  if (!needed || !definitionId) return null
  const keyOf = (await optional(resolveDefinitionKeys(client, [definitionId]))) ?? definitionKeyInId
  return keyOf(definitionId)
}

/** State, tokens, variables, incidents and tasks are PRIMARY; diagram, forms and cockpit links are enrichment. */
export async function buildInstanceDetailData(
  client: Client,
  engineId: string,
  args: { processInstanceId: string },
  urls?: { baseUrl: string; cockpitUrl?: string; provider: EngineProvider },
): Promise<InstanceDetailData> {
  const id = args.processInstanceId
  const byInstance = { processInstanceId: id }
  const [instance, activityTree, variables, incidents, incidentCount, openTasksRaw, openTaskCount] =
    await Promise.all([
      getProcessInstance({ client, path: { id } }),
      getActivityInstanceTree({ client, path: { id } }),
      readProcessInstanceVariables(client, id),
      getIncidents({ client, query: { ...byInstance, maxResults: INCIDENT_ROWS } }).then((rows) =>
        rowsOf<RawIncident>(rows),
      ),
      getIncidentsCount({ client, query: byInstance }).then(countOf),
      getTasks({
        client,
        query: { ...byInstance, maxResults: TASK_ROWS, sortBy: "created", sortOrder: "asc" },
      }).then((rows) => rowsOf<TaskData>(rows)),
      getTasksCount({ client, query: byInstance }).then(countOf),
    ])

  const definitionId = (instance as { definitionId?: string } | null)?.definitionId
  const [{ bpmnXml, unreadable }, defKey] = await Promise.all([
    readBpmnXml(client, definitionId),
    linkDefinitionKey(client, definitionId, !!urls && incidents.length > 0),
  ])

  const openTasks: InstanceDetailData["openTasks"] = await Promise.all(
    openTasksRaw.map(async (task) => ({
      ...task,
      // Null, never `{ fields: [] }` ("no form"): the widget then loads it via
      // camunda7_get_task_form, which fails loudly.
      formSchema: unreadable
        ? null
        : await buildTaskFormSchema(client, task.id, { task, bpmnXml }).catch(() => null),
    })),
  )

  const businessKey = (instance as { businessKey?: string | null } | null)?.businessKey ?? null
  const incidentRows: InstanceDetailData["incidents"] = incidents.map((i) => ({
    id: i.id ?? "",
    processInstanceId: i.processInstanceId ?? id,
    businessKey,
    incidentType: i.incidentType ?? "unknown",
    incidentMessage: i.incidentMessage ?? null,
    incidentTimestamp: i.incidentTimestamp ?? "",
    recovery: incidentRecovery(i),
    cockpitInstanceUrl:
      urls && defKey
        ? buildInstanceCockpitUrl(
            urls,
            {
              key: defKey,
              version: definitionVersionFromId(definitionId),
              definitionId: definitionId ?? null,
              instanceId: id,
            },
            { tab: "incidents" },
          )
        : null,
  }))

  // The diagram names its process (no extra read): its own name, else its pool's.
  const processKey = definitionId ? definitionKeyInId(definitionId) : null
  return {
    instance: instance as unknown as InstanceDetailData["instance"],
    processDefinitionName: bpmnXml && processKey ? parseBpmnNames(bpmnXml, processKey).name : null,
    definitionKey: processKey,
    activityTree: activityTree as unknown as InstanceDetailData["activityTree"],
    variables: variables as unknown as InstanceDetailData["variables"],
    incidents: incidentRows,
    incidentCount,
    diagramDefinitionId: bpmnXml && definitionId ? definitionId : null,
    activeActivityIds: collectActiveActivityIds(activityTree),
    incidentActivityIds: collectIncidentActivityIds(incidents),
    openTasks,
    openTaskCount,
    engineId,
  }
}
