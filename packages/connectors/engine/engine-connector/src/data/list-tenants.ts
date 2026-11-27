/**
 * The tenant of the cockpit's lists of a key's runs (its instances, its jobs, `onlyTenant`):
 * opened from a process whose key holds other processes, a list narrows the key to the runs in
 * that process's tenant (`ListTenant`: null for those in none), which c7-core's `tenantQuery` and
 * `tenantBody` spell as the engine's filter, as the process's counts narrow; opened by its key
 * alone (from a process alone, or a key), it spans every tenant, as `processDefinitionKey` does on
 * every tool. A row of a list names the tenant of the version it runs on, its process's, which its
 * drill opens: never the run's own, which a tenant id provider may give a shared version's run.
 */

import type { Client } from "@miragon/pulse-c7-client"
import type { ListTenant } from "../view-models.js"
import { readCockpitProcess } from "./cockpit-process.js"
import {
  type DefinitionById,
  type DefinitionInfo,
  fetchDefinitionsById,
  fetchLatestDefinition,
  nameUnnamedDefinitions,
} from "./definition-info.js"
import { optional } from "./engine-reads.js"
import type { RawInstance } from "./instance-list-reads.js"

/** A tenant as a payload names it: only where there is one. */
export const tenantField = (tenantId: string | undefined) =>
  tenantId === undefined ? {} : { tenantId }

/** The tenant a list is narrowed to: only beside a key, a list of every process spans every one. */
export function tenantOfList(args: {
  processDefinitionKey?: string | undefined
  onlyTenant?: ListTenant | undefined
}): ListTenant | undefined {
  return args.processDefinitionKey ? args.onlyTenant : undefined
}

/**
 * The latest version a list of a key names, its process's in the tenant the list is narrowed to,
 * else over every tenant; none for a list of every process. An unknown key, or a tenant without
 * it, is the engine's not-found, never a list of zeros.
 */
export function latestOfList(
  client: Client,
  key: string | undefined,
  tenant: ListTenant | undefined,
): Promise<DefinitionInfo | null> {
  if (!key) return Promise.resolve(null)
  if (tenant === undefined) return fetchLatestDefinition(client, key)
  return readCockpitProcess(client, key, tenant).then(({ latest }) => latest)
}

/** What the rows of a page say of the version each runs on: its process's name and its tenant. */
interface RowDefinitions {
  nameOf: (definitionId: string) => string | null
  /** The version's tenant; none where it has none or it is unread. */
  tenantOf: (row: RawInstance) => string | undefined
}

/**
 * The rows whose versions a page reads by id: every row of a list of every process (its names);
 * of a list of one key, those whose instance names a tenant (an instance of none runs a version of
 * none), so a list of the runs in none reads none.
 */
function rowsToRead(
  page: readonly RawInstance[],
  scoped: DefinitionInfo | null,
): readonly RawInstance[] {
  return scoped === null ? page : page.filter((row) => row.tenantId)
}

/** The versions of `rows` by their ids; none read for no row. */
function versionsOf(
  client: Client,
  rows: readonly RawInstance[],
): Promise<ReadonlyMap<string, DefinitionById> | null> {
  if (rows.length === 0) return Promise.resolve(null)
  return optional(
    fetchDefinitionsById(
      client,
      rows.map((row) => row.definitionId),
    ),
  )
}

/** A row's version's tenant as the versions read name it; none unread. */
function tenantIn(versions: ReadonlyMap<string, DefinitionById> | null, row: RawInstance) {
  return (row.definitionId && versions?.get(row.definitionId)?.tenantId) || undefined
}

/**
 * ENRICHMENT: a failed read leaves the names null, the rows then show their keys, and the tenants
 * unread, a row's drill then names the key alone. A list of one key names its process; its rows'
 * tenants are their versions' (`rowsToRead`), read by id only where an instance names one, so an
 * engine without tenants is asked nothing more.
 */
export async function rowDefinitions(
  client: Client,
  page: RawInstance[],
  scoped: DefinitionInfo | null,
): Promise<RowDefinitions> {
  const [versions] = await Promise.all([
    versionsOf(client, rowsToRead(page, scoped)),
    scoped ? nameUnnamedDefinitions(client, [scoped]) : Promise.resolve(),
  ])
  if (versions && !scoped) await nameUnnamedDefinitions(client, [...versions.values()])
  const nameOf = (id: string) => versions?.get(id)?.name ?? null
  return {
    nameOf: scoped ? () => scoped.name : nameOf,
    tenantOf: (row) => tenantIn(versions, row),
  }
}
