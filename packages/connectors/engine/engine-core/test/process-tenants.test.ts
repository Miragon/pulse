import { describe, expect, test } from "vitest"
import {
  BpmnProcessId,
  DefinitionId,
  ProcessTenants,
  TenantId,
  type DefinitionSummary,
  type TenantReads,
  type VersionSummary,
} from "../src/index.js"

const KEY = BpmnProcessId("invoice")
const OTHER = BpmnProcessId("dispatch")

interface Deployed {
  readonly key: typeof KEY
  readonly tenant: string | null
  readonly version: number
}

const idOf = ({ key, tenant, version }: Deployed) =>
  DefinitionId(`${key}:${tenant ?? "-"}:${String(version)}`)

function versionOf(deployed: Deployed): VersionSummary {
  return {
    definition: {
      id: idOf(deployed),
      bpmnProcessId: deployed.key,
      tenantId: deployed.tenant === null ? null : TenantId(deployed.tenant),
      version: deployed.version,
    },
    running: 0,
    withIncident: 0,
    incidents: 0,
  }
}

class Engine implements TenantReads {
  readonly asked: string[] = []

  constructor(private readonly deployed: readonly Deployed[]) {}

  listVersions(bpmnProcessId: typeof KEY, tenantId: TenantId | null) {
    this.asked.push(`versions ${bpmnProcessId} ${tenantId ?? "-"}`)
    const versions = this.deployed
      .filter(({ key, tenant }) => key === bpmnProcessId && tenant === tenantId)
      .map(versionOf)
      .toSorted((left, right) => right.definition.version - left.definition.version)
    return Promise.resolve(versions)
  }

  listDefinitions(): Promise<readonly DefinitionSummary[]> {
    this.asked.push("definitions")
    const latest = new Map<string, VersionSummary>()
    for (const deployed of this.deployed) {
      const name = `${deployed.key}|${deployed.tenant ?? ""}`
      const known = latest.get(name)
      if (known === undefined || known.definition.version < deployed.version) {
        latest.set(name, versionOf(deployed))
      }
    }
    return Promise.resolve(
      [...latest.values()].map(({ definition }) => ({
        latest: definition,
        running: 0,
        withIncident: 0,
        incidents: 0,
      })),
    )
  }
}

const deployed = (tenant: string | null, version = 1, key = KEY): Deployed => ({
  key,
  tenant,
  version,
})

describe("ProcessTenants: a process named by its key without a tenant", () => {
  test("is the key's process without a tenant where the key has a version without one", async () => {
    const engine = new Engine([deployed("north"), deployed(null, 1), deployed(null, 2)])
    const found = await ProcessTenants.versionsOf(engine, KEY)
    expect(found.tenantId).toBeNull()
    expect(found.versions.map(({ definition }) => definition.version)).toEqual([2, 1])
    expect(engine.asked).toEqual(["versions invoice -"])
  })

  test("is the key's one tenant where it has no version without one", async () => {
    const engine = new Engine([
      deployed("north", 1),
      deployed("north", 2),
      deployed(null, 1, OTHER),
    ])
    const found = await ProcessTenants.versionsOf(engine, KEY)
    expect(found.tenantId).toBe("north")
    expect(found.versions.map(({ definition }) => definition.version)).toEqual([2, 1])
  })

  test("is the first of several tenants in the order of their ids, by code unit", async () => {
    const tenants = ["south", "north", "North", "east-2"]
    const engine = new Engine(tenants.map((tenant) => deployed(tenant)))
    const found = await ProcessTenants.versionsOf(engine, KEY)
    expect(found.tenantId).toBe("North")
    const summaries = await engine.listDefinitions()
    expect(ProcessTenants.tenantsOf(summaries, KEY)).toEqual(["North", "east-2", "north", "south"])
  })

  test("is the tenant that holds a version its id names", async () => {
    const engine = new Engine([deployed(null), deployed("north"), deployed("south", 3)])
    const south = await ProcessTenants.versionsOf(engine, KEY, idOf(deployed("south", 3)))
    expect(south.tenantId).toBe("south")
    const none = await ProcessTenants.versionsOf(engine, KEY, idOf(deployed(null)))
    expect(none.tenantId).toBeNull()
  })

  test("is the rule without an id where no tenant holds the version the id names", async () => {
    const engine = new Engine([deployed("south"), deployed("north")])
    const found = await ProcessTenants.versionsOf(engine, KEY, DefinitionId("invoice:gone:9"))
    expect(found.tenantId).toBe("north")
  })

  test("holds no version where the engine has none of the key", async () => {
    const engine = new Engine([deployed("north", 1, OTHER)])
    expect(await ProcessTenants.versionsOf(engine, KEY)).toEqual({ tenantId: null, versions: [] })
  })

  test("is the same process among an engine's processes, none where the key is not deployed", async () => {
    const engine = new Engine([deployed("south"), deployed("north"), deployed(null, 1, OTHER)])
    const summaries = await engine.listDefinitions()
    expect(ProcessTenants.summaryOf(summaries, KEY)?.latest.tenantId).toBe("north")
    expect(ProcessTenants.summaryOf(summaries, OTHER)?.latest.tenantId).toBeNull()
    const both = await new Engine([deployed("north"), deployed(null)]).listDefinitions()
    expect(ProcessTenants.summaryOf(both, KEY)?.latest.tenantId).toBeNull()
    expect(ProcessTenants.summaryOf(summaries, BpmnProcessId("unknown"))).toBeUndefined()
  })
})
