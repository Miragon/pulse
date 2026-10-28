import {
  fetchJobStacktrace,
  incidentRecovery,
  readProcessInstanceVariables,
  type Client,
} from "@miragon/pulse-camunda7-client"
import type {
  ActivityTree,
  IncidentDetailData,
  IncidentDetailJob,
  IncidentRecovery,
  VariableValue,
} from "../view-models.js"
import {
  getActivityInstanceTree,
  getHistoricActivityInstancesCount,
  getIncident,
  getJobs,
  getProcessDefinition,
  getProcessInstance,
} from "@miragon/pulse-camunda7-client/sdk"

import { buildInstanceCockpitUrl } from "../lib/cockpit-url.js"
import type { EngineProvider } from "../engine-provider.js"
import { bpmnProcessNameOf, readBpmnNames } from "@miragon/pulse-widget-shell/server"
import {
  definitionKeyInId,
  fetchDefinitionXml,
  processDefinitionKeyFromId,
} from "./definition-info.js"
import { optional, rowsOf } from "./engine-reads.js"

interface BuildOptions {
  baseUrl: string
  cockpitUrl?: string
  provider: EngineProvider
  incidentId: string
}

interface IncidentRecord {
  id: string
  processDefinitionId: string
  processInstanceId: string
  activityId: string
  jobId: string | null
  recovery: IncidentRecovery
  incidentType: string
  incidentMessage: string | null
  incidentTimestamp: string
}

interface RawIncident {
  id?: string | null
  processDefinitionId?: string | null
  processInstanceId?: string | null
  activityId?: string | null
  failedActivityId?: string | null
  /**
   * The failure target. For `failedJob` it is the job id; for other types
   * (e.g. `failedExternalTask`) it is some other resource, never a job id.
   */
  configuration?: string | null
  /** A delegated incident carries `null` configuration and message; the failure lives on the root cause. */
  rootCauseIncidentId?: string | null
  incidentType?: string | null
  incidentMessage?: string | null
  incidentTimestamp?: string | null
}

/** Activity and process come from the original incident, so the BPMN highlight stays in its diagram. */
function normalizeIncident(
  raw: RawIncident,
  fallbackId: string,
  failureSource: RawIncident,
): IncidentRecord {
  const incidentType = raw.incidentType ?? "unknown"
  // A delegated incident carries no configuration: its failure target (job
  // or external task) is the root cause's.
  const recovery = incidentRecovery({
    incidentType,
    configuration: failureSource.configuration ?? raw.configuration,
  })
  const jobId = recovery.action === "retry-job" ? recovery.jobId : null
  const activityId = raw.failedActivityId ?? raw.activityId ?? ""
  const message =
    failureSource.incidentMessage && failureSource.incidentMessage.length > 0
      ? failureSource.incidentMessage
      : raw.incidentMessage && raw.incidentMessage.length > 0
        ? raw.incidentMessage
        : null
  return {
    id: raw.id ?? fallbackId,
    processDefinitionId: raw.processDefinitionId ?? "",
    processInstanceId: raw.processInstanceId ?? "",
    activityId,
    jobId,
    recovery,
    incidentType,
    incidentMessage: message,
    incidentTimestamp: raw.incidentTimestamp ?? "",
  }
}

interface RawProcessInstance {
  id?: string | null
  definitionId?: string | null
  businessKey?: string | null
  suspended?: boolean | null
  ended?: boolean | null
}

interface RawJob {
  id?: string | null
  retries?: number | null
  exceptionMessage?: string | null
  dueDate?: string | null
}

interface RawDefinition {
  id?: string | null
  key?: string | null
  name?: string | null
  version?: number | null
}

function fetchDefinitionMeta(
  client: Client,
  processDefinitionId: string,
): Promise<RawDefinition | null> {
  if (!processDefinitionId) return Promise.resolve(null)
  return optional(
    getProcessDefinition({ client, path: { id: processDefinitionId } }) as Promise<RawDefinition>,
  )
}

/** PRIMARY: a failed read is a tool error. `null` only when the job is gone (retried meanwhile). */
async function fetchJob(client: Client, jobId: string): Promise<IncidentDetailJob | null> {
  const [jobs, rawStacktrace] = await Promise.all([
    getJobs({ client, query: { jobId, maxResults: 1 } }).then((rows) => rowsOf<RawJob>(rows)),
    // Optional enrichment: the failure tab renders without a stacktrace.
    fetchJobStacktrace(client, jobId).catch(() => null),
  ])

  const job = jobs[0]
  if (!job) return null

  return {
    id: job.id ?? jobId,
    retries: typeof job.retries === "number" ? job.retries : 0,
    exceptionMessage: job.exceptionMessage ?? null,
    stacktrace: rawStacktrace,
    dueDate: job.dueDate ?? null,
  }
}

/** PRIMARY: it decides which job and message the view shows, so a failed read is a tool error. */
async function fetchRootCauseIncident(
  client: Client,
  rawIncident: RawIncident,
): Promise<RawIncident | null> {
  const rootId = rawIncident.rootCauseIncidentId
  return rootId && rootId !== rawIncident.id
    ? await getIncident({ client, path: { id: rootId } })
    : null
}

type IncidentContext = [
  rawInstance: RawProcessInstance | null,
  activityTree: unknown,
  variables: unknown,
  xmlResponse: { bpmn20Xml?: string } | null,
  historyCount: { count?: number } | null,
  definitionMeta: RawDefinition | null,
  job: IncidentDetailJob | null,
]

/** Instance and job are PRIMARY (the tabs present them as facts); diagram, name and history total are enrichment. */
function fetchIncidentContext(client: Client, incident: IncidentRecord): Promise<IncidentContext> {
  const { processInstanceId, processDefinitionId, jobId } = incident
  return Promise.all([
    processInstanceId
      ? (getProcessInstance({
          client,
          path: { id: processInstanceId },
        }) as Promise<RawProcessInstance>)
      : Promise.resolve(null),
    processInstanceId
      ? (getActivityInstanceTree({ client, path: { id: processInstanceId } }) as Promise<unknown>)
      : Promise.resolve(null),
    processInstanceId
      ? (readProcessInstanceVariables(client, processInstanceId) as Promise<unknown>)
      : Promise.resolve({}),
    processDefinitionId
      ? optional(
          fetchDefinitionXml(client, processDefinitionId).then((xml) => ({
            bpmn20Xml: xml ?? undefined,
          })),
        )
      : Promise.resolve(null),
    // The History tab pages its rows itself; this is the total, null when history is disabled.
    processInstanceId
      ? (getHistoricActivityInstancesCount({ client, query: { processInstanceId } }).catch(
          () => null,
        ) as Promise<{ count?: number } | null>)
      : Promise.resolve(null),
    fetchDefinitionMeta(client, processDefinitionId),
    jobId ? fetchJob(client, jobId) : Promise.resolve(null),
  ])
}

/**
 * The key is the fetched definition's own: a bare generated id names none. When
 * the lookup failed the parse stands in for DISPLAY only; hand-offs then scope by
 * the exact id and the cockpit link is built only from `knownKey`.
 */
function deriveDefinitionInfo(
  definitionMeta: RawDefinition | null,
  processDefinitionId: string,
): {
  processDefinitionKey: string
  /** Null for a bare id whose lookup failed. */
  knownKey: string | null
  processDefinitionVersion: number | null
  processDefinitionName: string | null
} {
  const knownKey =
    definitionMeta?.key ?? (processDefinitionId ? definitionKeyInId(processDefinitionId) : null)
  const processDefinitionKey =
    knownKey ?? (processDefinitionId ? processDefinitionKeyFromId(processDefinitionId) : "")
  const processDefinitionVersion =
    typeof definitionMeta?.version === "number" ? definitionMeta.version : null
  return {
    processDefinitionKey,
    knownKey,
    processDefinitionVersion,
    processDefinitionName: definitionMeta?.name ?? null,
  }
}

/** Never a UUID as the key. */
function deriveCockpitInstanceUrl(
  options: BuildOptions,
  incident: IncidentRecord,
  knownKey: string | null,
  processDefinitionVersion: number | null,
): string | null {
  const { processInstanceId, processDefinitionId } = incident
  return processInstanceId && knownKey
    ? buildInstanceCockpitUrl(
        { baseUrl: options.baseUrl, cockpitUrl: options.cockpitUrl, provider: options.provider },
        {
          key: knownKey,
          version: processDefinitionVersion,
          definitionId: processDefinitionId,
          instanceId: processInstanceId,
        },
        { tab: "variables" },
      )
    : null
}

function toInstanceSummary(
  rawInstance: RawProcessInstance | null,
  incident: IncidentRecord,
): IncidentDetailData["instance"] {
  return {
    id: rawInstance?.id ?? incident.processInstanceId,
    definitionId: rawInstance?.definitionId ?? incident.processDefinitionId,
    businessKey: rawInstance?.businessKey ?? null,
    suspended: rawInstance?.suspended === true,
    ended: rawInstance?.ended === true,
  }
}

export async function buildIncidentDetailData(
  client: Client,
  options: BuildOptions,
): Promise<IncidentDetailData> {
  const rawIncident = (await getIncident({
    client,
    path: { id: options.incidentId },
  })) as unknown as RawIncident

  const rawRootCause = await fetchRootCauseIncident(client, rawIncident)

  const incident = normalizeIncident(rawIncident, options.incidentId, rawRootCause ?? rawIncident)
  const { processInstanceId, processDefinitionId, activityId } = incident

  const [rawInstance, activityTree, variables, xmlResponse, historyCount, definitionMeta, job] =
    await fetchIncidentContext(client, incident)

  const bpmnXml = xmlResponse?.bpmn20Xml ?? null
  const diagramNames = readBpmnNames(bpmnXml ?? "")

  const { processDefinitionKey, knownKey, processDefinitionVersion, processDefinitionName } =
    deriveDefinitionInfo(definitionMeta, processDefinitionId)
  // The engine names a process by `<process>` alone; the Modeler names the pool.
  const processName = processDefinitionName ?? bpmnProcessNameOf(diagramNames, processDefinitionKey)

  const cockpitInstanceUrl = deriveCockpitInstanceUrl(
    options,
    incident,
    knownKey,
    processDefinitionVersion,
  )

  return {
    incidentId: incident.id,
    incidentType: incident.incidentType,
    incidentMessage: incident.incidentMessage,
    incidentTimestamp: incident.incidentTimestamp,
    activityId,
    activityName: Object.hasOwn(diagramNames.elements, activityId)
      ? diagramNames.elements[activityId]
      : null,

    processDefinitionKey,
    processDefinitionId,
    processDefinitionName: processName,
    processDefinitionVersion,
    processInstanceId,
    businessKey: rawInstance?.businessKey ?? null,
    cockpitInstanceUrl,
    engineVendor: options.provider.branding.displayName,

    diagramDefinitionId: bpmnXml ? processDefinitionId : null,

    job,
    recovery: incident.recovery,

    instance: toInstanceSummary(rawInstance, incident),
    activityTree: activityTree as ActivityTree | null,
    variables: variables as Record<string, VariableValue>,

    historyTotalCount: typeof historyCount?.count === "number" ? historyCount.count : null,
  }
}
