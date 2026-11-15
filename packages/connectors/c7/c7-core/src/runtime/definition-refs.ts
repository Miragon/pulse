/**
 * The contract's reference to a process version (`DefinitionRef` of @miragon/pulse-engine-core)
 * from what an engine answer names of it: a definition of its own, or the definition fields of an
 * instance row of the history. Pure.
 */

import { BpmnProcessId, DefinitionId, type DefinitionRef } from "@miragon/pulse-engine-core"
import { compact } from "../util.js"

/** A definition as the engine names it: id, key, version and its name, if it has one. */
export interface DefinitionFields {
  readonly id: string
  readonly key: string
  readonly version: number
  readonly name?: string
}

/** A definition as an instance row of the history names it. */
export interface InstanceDefinitionFields {
  readonly processDefinitionId: string
  readonly processDefinitionKey: string
  readonly processDefinitionVersion: number
  readonly processDefinitionName?: string
}

/** The reference to `definition`: its key is the process id, a name only when it has one. */
export function definitionRefOf(definition: DefinitionFields): DefinitionRef {
  return {
    id: DefinitionId(definition.id),
    bpmnProcessId: BpmnProcessId(definition.key),
    version: definition.version,
    ...compact({ name: definition.name }),
  }
}

/** The reference to the version an instance row of the history runs on. */
export function definitionRefOfInstance(row: InstanceDefinitionFields): DefinitionRef {
  return definitionRefOf({
    id: row.processDefinitionId,
    key: row.processDefinitionKey,
    version: row.processDefinitionVersion,
    ...compact({ name: row.processDefinitionName }),
  })
}
