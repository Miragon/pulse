/**
 * The Camunda 7 status world: the cases where the status triage (`engine_status`, the CLI's
 * status), the chat overview's health and the web app's verdict could count apart, seeded into a C7
 * engine of the family over its REST API beside the conformance world, which Camunda 8 shares and
 * which holds none of them: a call chain whose call activity holds a copy of the called instance's
 * root incident, a multi-instance body's root incident beside an instance whose items wait at the
 * same element, a batch's incident outside any process, and the label's key deployed once more in
 * each of two tenants beside its version without one, the same key in three processes (F17): the
 * dispatch, which has no tenant, calls the label in the tenant pulse-north, as its call activity
 * names it, so the chain's root incident is raised on a tenant's version, and the status triage
 * counts a key over every tenant. Seeded the same into an engine at history level FULL and one at
 * NONE, it is the world `C7_STATUS_ENGINE` is recorded from.
 */

import type { C7SeedEngine } from "./c7-world.js"
import { deploy, deployed, start, waitForIncidents } from "./seed-calls.js"
import { counts, pollUntil, startFailingBatch, suspendBatch } from "./status-calls.js"
import {
  STATUS_APPROVAL_DIAGRAM,
  STATUS_CALLED_TENANT,
  STATUS_DISPATCH_DIAGRAM,
  STATUS_LABEL_DIAGRAM,
} from "./status-diagrams.js"

/** The status world's processes, its instances' business keys and the job its batch names. */
export const C7_STATUS_WORLD = {
  processes: {
    /** Its call activity, `Activity_PrintLabel`, calls the label process. */
    dispatch: "pulse-status-dispatch",
    /** Its service task, `Activity_RenderLabel`, fails: the chain's one root incident. */
    label: "pulse-status-label",
    /** Its multi-instance user task, `Activity_ApproveEach`, repeats once per `copies`. */
    approval: "pulse-status-approval",
  },
  /** The multi-instance user task, whose body Camunda 7 names `<id>#multiInstanceBody`. */
  multiInstanceElement: "Activity_ApproveEach",
  /** How many items the approving instance waits at. */
  items: 3,
  instances: {
    /** Waits at its call activity for the root incident of the label instance it called. */
    dispatch: "DSP-139",
    /** Waits at its three items of the multi-instance user task. */
    approving: "APR-139-1",
    /** Its multi-instance body failed: it names no `copies`. */
    failing: "APR-139-2",
  },
  /** A job id no engine assigns, which the batch sets the retries of. */
  unknownJob: "00000000-0000-4000-8000-000000000139",
  /**
   * The tenants the label's key is deployed in once more each: the dispatch's call starts the
   * label in pulse-north, whose version holds the chain's root incident; pulse-south runs nothing.
   */
  tenants: { north: STATUS_CALLED_TENANT, south: "pulse-south" },
} as const

type StatusProcess = keyof typeof C7_STATUS_WORLD.processes
type StatusInstance = keyof typeof C7_STATUS_WORLD.instances
type StatusTenant = keyof typeof C7_STATUS_WORLD.tenants

/**
 * The seeded status world: the engine's ids of its versions, of the label's version in each
 * tenant, of its instances and of its batch.
 */
export interface C7StatusWorldIds {
  readonly definitionIds: Readonly<Record<StatusProcess, string>>
  readonly tenantLabelIds: Readonly<Record<StatusTenant, string>>
  readonly instanceIds: Readonly<Record<StatusInstance, string>>
  readonly batchId: string
}

const DIAGRAMS: Readonly<Record<StatusProcess, string>> = {
  label: STATUS_LABEL_DIAGRAM,
  dispatch: STATUS_DISPATCH_DIAGRAM,
  approval: STATUS_APPROVAL_DIAGRAM,
}

async function deployAll(engine: C7SeedEngine): Promise<Record<StatusProcess, string>> {
  const ids: Partial<Record<StatusProcess, string>> = {}
  for (const process of ["label", "dispatch", "approval"] as const) {
    const id = C7_STATUS_WORLD.processes[process]
    ids[process] = await deploy(engine, { alias: `${id}@1`, process: id }, DIAGRAMS[process])
  }
  return ids as Record<StatusProcess, string>
}

/** Deploys the label once more in each of the world's tenants; answers their definition ids. */
async function deployInTenants(engine: C7SeedEngine): Promise<Record<StatusTenant, string>> {
  const process = C7_STATUS_WORLD.processes.label
  const ids: Partial<Record<StatusTenant, string>> = {}
  for (const tenant of ["north", "south"] as const) {
    const tenantId = C7_STATUS_WORLD.tenants[tenant]
    const deployment = { alias: `${process}@${tenantId}`, process, tenantId }
    ids[tenant] = (await deployed(engine, deployment, DIAGRAMS.label)).definitionId
  }
  return ids as Record<StatusTenant, string>
}

/** Starts the instance `name` on `definitionId` with `variables`; answers its id. */
function startOne(
  engine: C7SeedEngine,
  name: StatusInstance,
  definitionId: string,
  variables: Readonly<Record<string, number>> = {},
): Promise<string> {
  const businessKey = C7_STATUS_WORLD.instances[name]
  return start(engine, { businessKey, deployment: name, variables }, definitionId)
}

/** The instances, each once the engine settled the one before, so their incidents come in order. */
async function startAll(
  engine: C7SeedEngine,
  definitionIds: Readonly<Record<StatusProcess, string>>,
): Promise<Record<StatusInstance, string>> {
  const dispatch = await startOne(engine, "dispatch", definitionIds.dispatch)
  await waitForIncidents(engine, 1)
  const approving = await startOne(engine, "approving", definitionIds.approval, {
    copies: C7_STATUS_WORLD.items,
  })
  const tasks = `/task/count?processDefinitionKey=${C7_STATUS_WORLD.processes.approval}`
  await pollUntil(engine, tasks, counts(C7_STATUS_WORLD.items), "items waiting")
  const failing = await startOne(engine, "failing", definitionIds.approval)
  await waitForIncidents(engine, 2)
  return { dispatch, approving, failing }
}

/**
 * Seeds the status world: deploys its three processes and the label once more in each of the
 * world's tenants, starts the dispatch and waits for its chain's root incident (raised in the label
 * instance it called in pulse-north, a copy at its call activity), the
 * approving instance and its three items, the failing one and its body's root incident, then a
 * batch that fails by itself and its incident, and suspends that batch, so no job is executable
 * once the world stands. Answers the engine's ids, as plain strings.
 */
export async function seedC7StatusWorld(engine: C7SeedEngine): Promise<C7StatusWorldIds> {
  const definitionIds = await deployAll(engine)
  const tenantLabelIds = await deployInTenants(engine)
  const instanceIds = await startAll(engine, definitionIds)
  const batchId = await startFailingBatch(engine, C7_STATUS_WORLD.unknownJob)
  await waitForIncidents(engine, 3)
  await suspendBatch(engine, batchId)
  await pollUntil(engine, "/job/count?executable=true&active=true", counts(0), "rest")
  return { definitionIds, tenantLabelIds, instanceIds, batchId }
}
