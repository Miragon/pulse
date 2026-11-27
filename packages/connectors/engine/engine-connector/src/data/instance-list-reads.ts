/**
 * The reads of the cockpit's instance list over the SDK, as c7-core's search bodies take them
 * (`searchedInstances`, #717): a body's count, and a window of its rows through the POST query,
 * every body in the list's one total order, which c7-core's page of two halves relies on.
 */

import type { Client } from "@miragon/pulse-c7-client"
import { queryProcessInstances, queryProcessInstancesCount } from "@miragon/pulse-c7-client/sdk"
import type { InstanceBodyReads } from "@miragon/pulse-c7-core"
import { countOf, rowsOf } from "./engine-reads.js"

/**
 * The instance id breaks ties: most instances have no business key and the engine
 * adds no tie-break once a sort is given, so paging would repeat or skip rows.
 * Only the POST query takes two keys.
 */
const INSTANCE_LIST_ORDER = [
  { sortBy: "businessKey", sortOrder: "asc" },
  { sortBy: "instanceId", sortOrder: "asc" },
] as const

/** A row of the runtime's instance list, as the engine answers it. */
export interface RawInstance {
  id?: string | null
  definitionId?: string | null
  businessKey?: string | null
  suspended?: boolean | null
  /** The instance's tenant: its version's, or one a tenant id provider gave a shared version's. */
  tenantId?: string | null
}

/** c7-core's reads of an instance body over `client`: its count, and its rows in the list's order. */
export function instanceReads(client: Client): InstanceBodyReads<RawInstance> {
  return {
    count: (body) => queryProcessInstancesCount({ client, body }).then(countOf),
    list: (body, query) =>
      queryProcessInstances({
        client,
        query,
        body: { ...body, sorting: [...INSTANCE_LIST_ORDER] },
      }).then((rows) => rowsOf<RawInstance>(rows)),
  }
}
