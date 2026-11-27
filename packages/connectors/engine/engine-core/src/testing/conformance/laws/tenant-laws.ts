import { BpmnProcessId, TenantId, type DefinitionId } from "../../../model/ids.js"
import type { CalledProcess, DefinitionRef } from "../../../model/read-models.js"
import { Ensure } from "../ensure.js"
import { TENANT_CASE, type TenantConformanceCase } from "../tenant-harness.js"
import { WORLD_TENANT, type WorldTenant } from "../world/tenant-world.js"
import { WORLD_CALL, WORLD_PROCESS } from "../world/world.js"

const LABEL = BpmnProcessId(WORLD_PROCESS[WORLD_CALL.called])

class TenantReads {
  static tenantOf(tenant: WorldTenant | null): TenantId | null {
    return tenant === null ? null : TenantId(WORLD_TENANT[tenant])
  }

  static ref({ id, tenantId, version }: Pick<DefinitionRef, "id" | "tenantId" | "version">) {
    return { id, tenantId, version }
  }

  static byTenant<Item extends { readonly tenantId: TenantId | null }>(
    items: readonly Item[],
  ): Item[] {
    return items.toSorted((left, right) =>
      (left.tenantId ?? "").localeCompare(right.tenantId ?? ""),
    )
  }

  static call(call: CalledProcess) {
    return {
      elementId: call.elementId,
      bpmnProcessId: call.bpmnProcessId,
      tenantId: call.tenantId,
      definition: call.definition === undefined ? undefined : TenantReads.ref(call.definition),
    }
  }
}

const tenantsApart: TenantConformanceCase = {
  name: TENANT_CASE.tenantsApart,
  async run({ runtime, world, tenantWorld }) {
    const summaries = (await runtime.listDefinitions()).filter(
      (summary) => summary.latest.bpmnProcessId === LABEL,
    )
    const actual = Ensure.describe(
      TenantReads.byTenant(summaries.map((summary) => TenantReads.ref(summary.latest))),
    )
    const expected = Ensure.describe([
      { id: world.definitionIds["label@1"], tenantId: null, version: 1 },
      { id: tenantWorld.definitionIds["north/label@1"], tenantId: WORLD_TENANT.north, version: 1 },
      { id: tenantWorld.definitionIds["south/label@2"], tenantId: WORLD_TENANT.south, version: 2 },
    ])
    Ensure.that(actual === expected, this.name, `${LABEL} expected ${expected}, got ${actual}`)
  },
}

const tenantVersions: TenantConformanceCase = {
  name: TENANT_CASE.tenantVersions,
  async run({ runtime, world, tenantWorld }) {
    const ids = { ...world.definitionIds, ...tenantWorld.definitionIds }
    const expected: readonly (readonly [WorldTenant | null, readonly (keyof typeof ids)[]])[] = [
      [null, ["label@1"]],
      ["north", ["north/label@1"]],
      ["south", ["south/label@2", "south/label@1"]],
    ]
    for (const [tenant, aliases] of expected) {
      const tenantId = TenantReads.tenantOf(tenant)
      const versions = await runtime.listVersions(LABEL, tenantId)
      const actual = Ensure.describe(versions.map(({ definition }) => TenantReads.ref(definition)))
      const wanted = Ensure.describe(
        aliases.map((alias) => ({
          id: ids[alias],
          tenantId,
          version: Number(alias.slice(alias.indexOf("@") + 1)),
        })),
      )
      Ensure.that(
        actual === wanted,
        this.name,
        `${LABEL} in ${tenantId ?? "no tenant"} expected ${wanted}, got ${actual}`,
      )
    }
  },
}

const tenantCalls: TenantConformanceCase = {
  name: TENANT_CASE.tenantCalls,
  async run({ runtime, world, tenantWorld }) {
    const callers: readonly (readonly [WorldTenant | null, DefinitionId, DefinitionId])[] = [
      [null, world.definitionIds["dispatch@1"], world.definitionIds["label@1"]],
      [
        "north",
        tenantWorld.definitionIds["north/dispatch@1"],
        tenantWorld.definitionIds["north/label@1"],
      ],
    ]
    for (const [tenant, caller, called] of callers) {
      const tenantId = TenantReads.tenantOf(tenant)
      const calls = await runtime.getCalledProcesses({ id: caller, tenantId })
      const actual = Ensure.describe(calls.map((call) => TenantReads.call(call)))
      const expected = Ensure.describe([
        {
          elementId: WORLD_CALL.elementId,
          bpmnProcessId: LABEL,
          tenantId,
          definition: { id: called, tenantId, version: 1 },
        },
      ])
      Ensure.that(
        actual === expected,
        this.name,
        `dispatch in ${tenantId ?? "no tenant"} expected ${expected}, got ${actual}`,
      )
    }
  },
}

export const TENANT_LAWS: readonly TenantConformanceCase[] = [
  tenantsApart,
  tenantVersions,
  tenantCalls,
]
