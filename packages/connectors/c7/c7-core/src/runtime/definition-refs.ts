/**
 * The contract's reference to a process version (`DefinitionRef` of @miragon/pulse-engine-core)
 * from what an engine answer names of it: a definition of its own, or the definition fields of an
 * instance row of the history with the tenant of the version, never the instance's: a shared
 * definition (none) runs instances a tenant id provider gave a tenant, and the engine resolves the
 * version's calls in the version's tenant. Pure.
 */

import {
  BpmnProcessId,
  DefinitionId,
  type DefinitionRef,
  TenantId,
} from "@miragon/pulse-engine-core"
import { compact } from "../util.js"

/**
 * A definition as the engine names it: id, key, version, its tenant and its name, if it has them
 * (a tenant absent, null or "" is none).
 */
export interface DefinitionFields {
  readonly id: string
  readonly key: string
  readonly version: number
  readonly tenantId?: string | null
  readonly name?: string
}

/** A definition as an instance row of the history names it, the row's tenant the instance's. */
export interface InstanceDefinitionFields {
  readonly processDefinitionId: string
  readonly processDefinitionKey: string
  readonly processDefinitionVersion: number
  readonly processDefinitionName?: string
  readonly tenantId?: string | null
}

/**
 * The tenant of each version instance rows run, by the version's id, as its definition row names
 * it (`versionTenantsOf`): a version the map does not hold has none.
 */
export type VersionTenants = ReadonlyMap<string, string | null>

/** The tenant `tenantId` names: none for an absent, null or empty one. */
export function tenantIdOf(tenantId: string | null | undefined): TenantId | null {
  return tenantId ? TenantId(tenantId) : null
}

/**
 * The reference to `definition`: its key is the process id, its tenant null where it has none, a
 * name only when it has one.
 */
export function definitionRefOf(definition: DefinitionFields): DefinitionRef {
  return {
    id: DefinitionId(definition.id),
    bpmnProcessId: BpmnProcessId(definition.key),
    tenantId: tenantIdOf(definition.tenantId),
    version: definition.version,
    ...compact({ name: definition.name }),
  }
}

/**
 * The reference to the version an instance row of the history runs on, in the version's tenant
 * `tenants` names, never the row's.
 */
export function definitionRefOfInstance(
  row: InstanceDefinitionFields,
  tenants: VersionTenants,
): DefinitionRef {
  return definitionRefOf({
    id: row.processDefinitionId,
    key: row.processDefinitionKey,
    version: row.processDefinitionVersion,
    tenantId: tenants.get(row.processDefinitionId) ?? null,
    ...compact({ name: row.processDefinitionName }),
  })
}
