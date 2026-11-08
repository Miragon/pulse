import { readProcessInstanceVariables, type Client } from "@miragon/pulse-engine-client"
import { incidentRecovery } from "@miragon/pulse-engine-core"
import type { InstanceDetailData, TaskData } from "../view-models.js"
import {
  getActivityInstanceTree,
  getIncidents,
  getIncidentsCount,
  getProcessInstance,
  getTasks,
  getTasksCount,
} from "@miragon/pulse-engine-client/sdk"
import { buildTaskFormSchema } from "../lib/bpmn/task-form-schema.js"
import { collectActiveActivityIds, collectIncidentActivityIds } from "../lib/bpmn/activity-tree.js"
import { bpmnProcessNameOf, readBpmnNames } from "@miragon/pulse-widget-shell/server"
import { buildInstanceCockpitUrl } from "../lib/engine/cockpit-url.js"
import type { EngineProvider } from "../engine-provider.js"
import {
  definitionKeyInId,
  definitionVersionFromId,
  fetchDefinitionsById,
  fetchDefinitionXml,
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

/**
 * ENRICHMENT, for the drill to the process and the cockpit links: a bare generated id costs one
 * read of that one definition (never the engine-wide statistics, since an instance has one key);
 * a failed read is no drill and no link, never the UUID as a key.
 */
async function instanceDefinitionKey(
  client: Client,
  definitionId: string | undefined,
): Promise<string | null> {
  if (!definitionId) return null
  const inId = definitionKeyInId(definitionId)
  if (inId !== null) return inId
  const byId = await optional(fetchDefinitionsById(client, [definitionId]))
  return byId?.get(definitionId)?.key || null
}

/**
 * State, tokens, variables, incidents and tasks are PRIMARY; diagram, names, forms, the process
 * key and cockpit links are enrichment.
 */
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
    instanceDefinitionKey(client, definitionId),
  ])
  // The diagram names the process and each incident's element (no extra read).
  const diagramNames = bpmnXml ? readBpmnNames(bpmnXml) : null
  const elementName = (activityId: string | null) =>
    diagramNames && activityId && Object.hasOwn(diagramNames.elements, activityId)
      ? diagramNames.elements[activityId]
      : null

  const openTasks: InstanceDetailData["openTasks"] = await Promise.all(
    openTasksRaw.map(async (task) => ({
      ...task,
      // Null, never `{ fields: [] }` ("no form"): the widget then loads it via
      // engine_get_task_form, which fails loudly.
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
    activityId: i.activityId ?? null,
    activityName: elementName(i.activityId ?? null),
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

  return {
    instance: instance as unknown as InstanceDetailData["instance"],
    // Its own name, else its pool's.
    processDefinitionName: diagramNames && defKey ? bpmnProcessNameOf(diagramNames, defKey) : null,
    definitionKey: defKey,
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
