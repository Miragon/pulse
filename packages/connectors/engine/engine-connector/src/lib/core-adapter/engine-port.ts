/**
 * The engine port of @miragon/pulse-c7-core over the engine client: one typed SDK read per
 * operation the composites send (c7-core's INSPECT_OPERATIONS and STATUS_OPERATIONS), the
 * text and variable reads through the engine contract, at most 8 requests in flight per call.
 * Built per tool call on the client `withEngine` resolved (invariant 2): never cached.
 */

import {
  type Client,
  EngineRequestError,
  fetchExternalTaskErrorDetails,
  fetchJobStacktrace,
  readProcessInstanceVariables,
} from "@miragon/pulse-engine-client"
import {
  getActivityInstanceTree,
  getBatchStatistics,
  getEventSubscriptions,
  getExternalTasks,
  getExternalTasksCount,
  getHistoricActivityInstances,
  getHistoricIncidents,
  getHistoricProcessInstance,
  getHistoricProcessInstances,
  getHistoricVariableInstances,
  getIncidents,
  getIncidentsCount,
  getJobDefinitions,
  getJobs,
  getJobsCount,
  getProcessDefinitions,
  getProcessDefinitionStatistics,
  getProcessInstance,
  getProcessInstances,
  getRestApiVersion,
  getTasks,
  getTasksCount,
} from "@miragon/pulse-engine-client/sdk"
import {
  createEnginePort,
  type EngineFailure,
  isMissing,
  type EnginePort,
  type EngineTransport,
  type OperationInput,
  Slots,
} from "@miragon/pulse-c7-core"

type Read = (client: Client, input: OperationInput) => Promise<unknown>

/**
 * The query as the SDK types it. The engine reads every query value as text, so c7-core's
 * strings and the numbers and booleans the SDK types are the same wire value; undefined entries
 * are not sent.
 */
function engineQuery(input: OperationInput): never {
  return input.query as never
}

/** The single path value (`{id}`) of the operation. */
function idOf(input: OperationInput): string {
  const [id] = input.pathArgs
  if (id === undefined) throw new Error("c7-core sent an operation without its id")
  return id
}

/** Every operation c7-core may send, by its operation id (the CLI catalog's names). */
export const READS: Readonly<Record<string, Read>> = {
  getProcessInstance: (client, input) => getProcessInstance({ client, path: { id: idOf(input) } }),
  getHistoricProcessInstance: (client, input) =>
    getHistoricProcessInstance({ client, path: { id: idOf(input) } }),
  getHistoricProcessInstances: (client, input) =>
    getHistoricProcessInstances({ client, query: engineQuery(input) }),
  getProcessInstances: (client, input) =>
    getProcessInstances({ client, query: engineQuery(input) }),
  getActivityInstanceTree: (client, input) =>
    getActivityInstanceTree({ client, path: { id: idOf(input) } }),
  getIncidents: (client, input) => getIncidents({ client, query: engineQuery(input) }),
  getIncidentsCount: (client, input) => getIncidentsCount({ client, query: engineQuery(input) }),
  getEventSubscriptions: (client, input) =>
    getEventSubscriptions({ client, query: engineQuery(input) }),
  getTasks: (client, input) => getTasks({ client, query: engineQuery(input) }),
  getTasksCount: (client, input) => getTasksCount({ client, query: engineQuery(input) }),
  getExternalTasks: (client, input) => getExternalTasks({ client, query: engineQuery(input) }),
  getExternalTasksCount: (client, input) =>
    getExternalTasksCount({ client, query: engineQuery(input) }),
  getJobs: (client, input) => getJobs({ client, query: engineQuery(input) }),
  getJobsCount: (client, input) => getJobsCount({ client, query: engineQuery(input) }),
  getProcessDefinitions: (client, input) =>
    getProcessDefinitions({ client, query: engineQuery(input) }),
  getProcessDefinitionStatistics: (client, input) =>
    getProcessDefinitionStatistics({ client, query: engineQuery(input) }),
  getJobDefinitions: (client, input) => getJobDefinitions({ client, query: engineQuery(input) }),
  // The contract reads: serialized variables, text/plain stacktraces and error details.
  getProcessInstanceVariables: (client, input) => readProcessInstanceVariables(client, idOf(input)),
  getHistoricVariableInstances: (client, input) =>
    getHistoricVariableInstances({ client, query: engineQuery(input) }),
  getHistoricActivityInstances: (client, input) =>
    getHistoricActivityInstances({ client, query: engineQuery(input) }),
  getHistoricIncidents: (client, input) =>
    getHistoricIncidents({ client, query: engineQuery(input) }),
  getStacktrace: (client, input) => fetchJobStacktrace(client, idOf(input)),
  getExternalTaskErrorDetails: (client, input) =>
    fetchExternalTaskErrorDetails(client, idOf(input)),
  // The one operation id the SDK spells differently.
  getRestAPIVersion: (client) => getRestApiVersion({ client }),
  getBatchStatistics: (client, input) => getBatchStatistics({ client, query: engineQuery(input) }),
}

/**
 * The engine answer of an `http` failure; unreachable, connection, timeout, cancelled and every
 * other error give undefined, so c7-core rethrows them unchanged.
 */
export function engineFailure(error: unknown): EngineFailure | undefined {
  if (!(error instanceof EngineRequestError) || error.kind !== "http") return undefined
  if (error.httpStatus === undefined) return undefined
  return {
    status: error.httpStatus,
    ...(error.type === undefined ? {} : { engineType: error.type }),
    engineMessage: error.engineMessage,
  }
}

/**
 * c7-core's missing-resource rule (`isMissing`) over an engine-client error: an engine 404
 * that names a missing resource. A wrong REST root (a 404 `NotFoundException`, or a 404 without
 * an engine answer) is no missing resource; it fails loud wherever a caller reads it.
 */
export function isMissingResource(error: unknown): boolean {
  return isMissing(engineFailure(error))
}

/**
 * The value of `read`, or `null` when it names a missing resource ({@link isMissingResource});
 * every other failure, a wrong REST root included, rejects.
 */
export async function noneIfMissing<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read
  } catch (error) {
    if (isMissingResource(error)) return null
    throw error
  }
}

/** c7-core's port over `client`, with one set of 8 slots for this call. */
export function enginePortFor(client: Client): EnginePort {
  const slots = new Slots()
  const transport: EngineTransport = {
    async send(operationId, input) {
      const read = READS[operationId]
      if (read === undefined) {
        throw new Error(`c7-core asked for ${operationId}, which the engine port does not map`)
      }
      return slots.run(() => read(client, input))
    },
    json: (answer) => answer,
    text: (answer) => (typeof answer === "string" ? answer : undefined),
    failure: engineFailure,
  }
  return createEnginePort(transport)
}
