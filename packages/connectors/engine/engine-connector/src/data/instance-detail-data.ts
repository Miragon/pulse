import { readProcessInstanceVariables, type Client } from "@miragon/pulse-c7-client"
import { elementOfActivity, incidentRecovery, rootIdOfCopy } from "@miragon/pulse-c7-core"
import type { InstanceDetailData, TaskData } from "../view-models.js"
import {
  getActivityInstanceTree,
  getHistoricProcessInstance,
  getIncidents,
  getIncidentsCount,
  getProcessInstance,
  getTasks,
  getTasksCount,
} from "@miragon/pulse-c7-client/sdk"
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
import { fetchRootCauses } from "./incident-scan.js"

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
  rootCauseIncidentId?: string | null
}

/**
 * ENRICHMENT, the instance's caller and start from its history, one read (as the webview reads
 * them): on history level none, or when the read fails, both are null, never a guess.
 */
async function readHistoricInstance(
  client: Client,
  id: string,
): Promise<{ callerInstanceId: string | null; startTime: string | null }> {
  const historic = await optional(getHistoricProcessInstance({ client, path: { id } }))
  return {
    callerInstanceId: historic?.superProcessInstanceId || null,
    startTime: historic?.startTime || null,
  }
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

/** The process of the version an instance runs on: its key, and its tenant where it has one. */
interface InstanceProcess {
  key: string | null
  tenantId?: string
}

/**
 * ENRICHMENT, for the drill to the process and the cockpit links: a bare generated id costs one
 * read of that one definition (never the engine-wide statistics, since an instance has one key);
 * a failed read is no drill and no link, never the UUID as a key. The process's tenant is its
 * version's, never the instance's (a shared version runs instances a tenant id provider gave a
 * tenant): an instance of no tenant runs a version of none, and only an instance that names one
 * costs that read of its version, so an engine without tenants is asked nothing more; a failed
 * read names no tenant, so the drill names the key alone.
 */
async function instanceProcess(
  client: Client,
  definitionId: string | undefined,
  instanceTenantId: string | null | undefined,
): Promise<InstanceProcess> {
  if (!definitionId) return { key: null }
  const inId = definitionKeyInId(definitionId)
  if (inId !== null && !instanceTenantId) return { key: inId }
  const byId = await optional(fetchDefinitionsById(client, [definitionId]))
  const version = byId?.get(definitionId)
  const key = inId ?? (version?.key || null)
  return version?.tenantId ? { key, tenantId: version.tenantId } : { key }
}

/**
 * The diagram's name of the element `activityId` stands for: a multi-instance body's is the
 * activity it repeats (c7-core's `elementOfActivity`), whose row keeps the body's own id; null
 * without a diagram, an activity or a name.
 */
function elementNameOf(
  names: ReturnType<typeof readBpmnNames> | null,
  activityId: string | null | undefined,
): string | null {
  const element = activityId ? elementOfActivity(activityId) : undefined
  return names && element && Object.hasOwn(names.elements, element)
    ? (names.elements[element] ?? null)
    : null
}

/**
 * State, tokens, variables, incidents and tasks are PRIMARY; diagram, names, forms, the process
 * key, cockpit links, the caller, the start and a copy's root incident are enrichment.
 */
export async function buildInstanceDetailData(
  client: Client,
  engineId: string,
  args: { processInstanceId: string },
  urls?: { baseUrl: string; cockpitUrl?: string; provider: EngineProvider },
): Promise<InstanceDetailData> {
  const id = args.processInstanceId
  const byInstance = { processInstanceId: id }
  // When the reads began: the bar's "As of".
  const fetchedAt = new Date().toISOString()
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

  const { definitionId, tenantId: instanceTenantId } =
    (instance as { definitionId?: string; tenantId?: string | null } | null) ?? {}
  const [{ bpmnXml, unreadable }, process, historic, rootCauses] = await Promise.all([
    readBpmnXml(client, definitionId),
    instanceProcess(client, definitionId, instanceTenantId),
    readHistoricInstance(client, id),
    // A copy at a call activity holds no message: its root incident in the called instance does.
    fetchRootCauses(client, incidents),
  ])
  // The diagram names the process and each incident's element (no extra read).
  const diagramNames = bpmnXml ? readBpmnNames(bpmnXml) : null
  const defKey = process.key

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
    activityName: elementNameOf(diagramNames, i.activityId),
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
    rootIncidentId: rootIdOfCopy(i) ?? null,
    rootCause: i.id ? (rootCauses.get(i.id) ?? null) : null,
  }))

  return {
    instance: instance as unknown as InstanceDetailData["instance"],
    // Its own name, else its pool's.
    processDefinitionName: diagramNames && defKey ? bpmnProcessNameOf(diagramNames, defKey) : null,
    definitionKey: defKey,
    ...(process.tenantId === undefined ? {} : { tenantId: process.tenantId }),
    callerInstanceId: historic.callerInstanceId,
    startTime: historic.startTime,
    activityTree: activityTree as unknown as InstanceDetailData["activityTree"],
    variables: variables as unknown as InstanceDetailData["variables"],
    incidents: incidentRows,
    incidentCount,
    diagramDefinitionId: bpmnXml && definitionId ? definitionId : null,
    activeActivityIds: collectActiveActivityIds(activityTree),
    incidentActivityIds: collectIncidentActivityIds(incidents),
    openTasks,
    openTaskCount,
    fetchedAt,
    engineId,
  }
}
