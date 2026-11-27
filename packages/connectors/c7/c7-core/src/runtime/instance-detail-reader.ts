/**
 * The detail of an instance (`getInstanceDetail` of the engine contract): the inspection's view
 * and, in parallel, the instance's typed variables of every scope (when they cannot be read, the
 * inspection's map stands in), then the version of each called instance one of its root incidents
 * was raised in: as the runtime lists it while that instance runs, else from the history. None for
 * an instance the engine does not know or that is gone meanwhile, or for an id no engine assigns,
 * without a request. Beyond the contract, the same reads give the cause of each root incident as
 * the cockpit's cause view takes it (`readWithCauses`).
 */

import type { IncidentId, InstanceDetail, InstanceId } from "@miragon/pulse-engine-core"
import { endedMeanwhile } from "../inspect.js"
import type { EnginePort } from "../port.js"
import type { IncidentCauseKey } from "../verdict.js"
import { definitionRefOf, definitionRefOfInstance } from "./definition-refs.js"
import { isEngineId } from "./engine-ids.js"
import { readHistoricInstances } from "./historic-instances.js"
import { instanceDetailOf } from "./instance-detail.js"
import { incidentCausesOf } from "./instance-incidents.js"
import { type InspectView, type Inspection, InstanceInspection } from "./instance-inspection.js"
import type { DefinitionsByInstance } from "./tree-versions.js"
import { readVariableInstances, type VariableRow } from "./variable-instances.js"

/** The ids of the called instances the root incidents of `view` were raised in, once each. */
function calledIdsOf(view: InspectView): string[] {
  const called = view.incidents
    .map((incident) => incident.processInstanceId)
    .filter(
      (instanceId): instanceId is string => instanceId !== undefined && instanceId !== view.id,
    )
  return [...new Set(called)]
}

/**
 * An instance's detail and the cause of each of its root incidents as the cockpit's cause view
 * takes it, by incident id: the detail names a multi-instance body's incident by the activity it
 * repeats, its cause by the body's own id, which the cause view reads.
 */
export interface InstanceDetailWithCauses {
  readonly detail: InstanceDetail
  readonly causes: ReadonlyMap<IncidentId, IncidentCauseKey>
}

/** Reads the detail of an instance over the engine's port. */
export class InstanceDetailReader {
  constructor(
    private readonly port: EnginePort,
    private readonly inspection: Inspection = new InstanceInspection(port),
  ) {}

  /** The detail of `instanceId`; undefined when the engine does not know it. */
  async read(instanceId: InstanceId): Promise<InstanceDetail | undefined> {
    return (await this.readWithCauses(instanceId))?.detail
  }

  /** The detail of `instanceId` with its root incidents' causes; undefined as `read` is. */
  async readWithCauses(instanceId: InstanceId): Promise<InstanceDetailWithCauses | undefined> {
    if (!isEngineId(instanceId)) {
      return undefined
    }
    const [view, typed] = await Promise.all([
      this.inspected(instanceId),
      this.typedVariables(instanceId),
    ])
    if (view === undefined) {
      return undefined
    }
    const detail = instanceDetailOf(view, await this.definitionsOf(view), typed)
    return { detail, causes: incidentCausesOf(view) }
  }

  private async inspected(instanceId: string): Promise<InspectView | undefined> {
    try {
      return await this.inspection.inspect(instanceId)
    } catch (error: unknown) {
      if (endedMeanwhile(this.port, error)) {
        return undefined
      }
      throw error
    }
  }

  private typedVariables(instanceId: string): Promise<VariableRow[] | undefined> {
    return readVariableInstances(this.port, instanceId).catch(() => undefined)
  }

  /** The version of each instance a root incident was raised in: the runtime's, else the history's. */
  private async definitionsOf(view: InspectView): Promise<DefinitionsByInstance> {
    const definitions = new Map([...view.versions, [view.id, definitionRefOf(view.definition)]])
    const called = calledIdsOf(view).filter((instanceId) => !definitions.has(instanceId))
    if (called.length > 0) {
      const rows = await readHistoricInstances(
        this.port,
        { processInstanceIds: called },
        { firstResult: 0, maxResults: called.length },
      )
      for (const row of rows) {
        definitions.set(row.id, definitionRefOfInstance(row))
      }
    }
    return definitions
  }
}
