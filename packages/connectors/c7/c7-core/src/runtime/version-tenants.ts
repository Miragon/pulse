/**
 * The tenant of each version a list of the history's instance rows runs (`VersionTenants`), read
 * from the versions' definition rows by their ids (`readDefinitionRows`), since an instance row
 * names the instance's tenant, which a shared definition (none) does not have. Only the versions
 * of rows that name a tenant are read: an instance without one runs a version without one, so an
 * engine without tenants is asked nothing more.
 */

import type { EnginePort } from "../port.js"
import type { InstanceDefinitionFields, VersionTenants } from "./definition-refs.js"
import { readDefinitionRows } from "./definition-rows.js"

/** The tenants of the versions `rows` run where a row names a tenant, by the versions' ids. */
export async function versionTenantsOf(
  port: EnginePort,
  rows: readonly InstanceDefinitionFields[],
): Promise<VersionTenants> {
  const ids = rows.filter((row) => row.tenantId).map((row) => row.processDefinitionId)
  if (ids.length === 0) return new Map()
  const definitions = await readDefinitionRows(port, "processDefinitionIdIn", ids)
  return new Map(definitions.map((definition) => [definition.id, definition.tenantId]))
}
