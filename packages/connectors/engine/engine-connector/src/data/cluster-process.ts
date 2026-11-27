import type { Client } from "@miragon/pulse-c7-client"
import type { ClusterProcess } from "../view-models.health.js"
import { type IncidentLike, UNKNOWN } from "./cluster-scan.js"
import { type DefinitionById, fetchDefinitionsById } from "./definition-info.js"
import { optional } from "./engine-reads.js"

/**
 * The tenant of the version `incident` was raised in: none for an incident of none (a run of no
 * tenant runs a version of none), else its version's as read by its id; undefined where unread.
 */
function versionTenantOf(
  incident: IncidentLike,
  versions: ReadonlyMap<string, DefinitionById>,
): string | null | undefined {
  if (!incident.tenantId) return null
  const version = versions.get(incident.processDefinitionId ?? "")
  return version === undefined ? undefined : version.tenantId
}

/**
 * The one process a cluster's incidents lie in (`ClusterDetailData.process`): their one key
 * (`keyOf`), in their versions' one tenant. A process's tenant is its version's, never the
 * incident's, since a tenant id provider may give a shared version's run a tenant: the versions are
 * read by their ids, once, only where an incident names a tenant, so an engine without tenants is
 * asked nothing more. ENRICHMENT: null where the incidents lie in several processes or name no key,
 * and where the read fails or misses a version, so the view opens no process it cannot name.
 */
export async function clusterProcessOf(
  client: Client,
  incidents: readonly IncidentLike[],
  keyOf: (incident: IncidentLike) => string,
): Promise<ClusterProcess | null> {
  const [key, ...others] = new Set(incidents.map(keyOf))
  if (key === undefined || key === UNKNOWN || others.length > 0) return null
  const tenanted = incidents.filter((incident) => incident.tenantId)
  const versions =
    tenanted.length === 0
      ? new Map<string, DefinitionById>()
      : await optional(
          fetchDefinitionsById(
            client,
            tenanted.map((incident) => incident.processDefinitionId),
          ),
        )
  if (versions === null) return null
  const tenants = new Set(incidents.map((incident) => versionTenantOf(incident, versions)))
  const [tenant, ...more] = tenants
  if (tenant === undefined || more.length > 0) return null
  return tenant === null
    ? { processDefinitionKey: key }
    : { processDefinitionKey: key, tenantId: tenant }
}
