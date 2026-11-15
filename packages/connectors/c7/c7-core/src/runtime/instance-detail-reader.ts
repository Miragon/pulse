/**
 * The detail of an instance (`getInstanceDetail` of the engine contract): the inspection's view
 * and, in parallel, the instance's typed variables of every scope (when they cannot be read, the
 * inspection's map stands in), then the version of each called instance one of its root incidents
 * was raised in, from the history. None for an instance the engine does not know or that is gone
 * meanwhile, or for an id no engine assigns, without a request.
 */

import type { InstanceDetail, InstanceId } from "@miragon/pulse-engine-core"
import { endedMeanwhile } from "../inspect.js"
import type { EnginePort } from "../port.js"
import { definitionRefOf, definitionRefOfInstance } from "./definition-refs.js"
import { isEngineId } from "./engine-ids.js"
import { readHistoricInstances } from "./historic-instances.js"
import { instanceDetailOf } from "./instance-detail.js"
import type { DefinitionsByInstance } from "./instance-incidents.js"
import { type InspectView, type Inspection, InstanceInspection } from "./instance-inspection.js"
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

/** Reads the detail of an instance over the engine's port. */
export class InstanceDetailReader {
  constructor(
    private readonly port: EnginePort,
    private readonly inspection: Inspection = new InstanceInspection(port),
  ) {}

  /** The detail of `instanceId`; undefined when the engine does not know it. */
  async read(instanceId: InstanceId): Promise<InstanceDetail | undefined> {
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
    return instanceDetailOf(view, await this.definitionsOf(view), typed)
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

  private async definitionsOf(view: InspectView): Promise<DefinitionsByInstance> {
    const definitions = new Map([[view.id, definitionRefOf(view.definition)]])
    const called = calledIdsOf(view)
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
