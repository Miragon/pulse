import { describe, expect, test } from "vitest"
import {
  FailingRuntime,
  type DefinitionSummary,
  type ProcessRuntime,
  type VersionSummary,
} from "../src/index.js"
import {
  ConformanceKit,
  FakeEngine,
  FakeWorld,
  PatchedRuntime,
  TENANT_CASE,
  type TenantCaseName,
  type TenantHarness,
} from "../src/testing/index.js"

type Sabotage = (runtime: ProcessRuntime) => Partial<ProcessRuntime>

function harnessWith(sabotage?: Sabotage): TenantHarness {
  const { state, world, tenantWorld } = FakeWorld.seedWithTenants()
  const runtime = new FakeEngine(state)
  return {
    runtime: sabotage === undefined ? runtime : new PatchedRuntime(runtime, sabotage(runtime)),
    world,
    tenantWorld,
  }
}

async function failingCases(harness: TenantHarness): Promise<TenantCaseName[]> {
  const failing: TenantCaseName[] = []
  for (const law of ConformanceKit.tenantLaws()) {
    await law.run(harness).catch(() => failing.push(law.name as TenantCaseName))
  }
  return failing.sort()
}

async function everyTenantOf(
  runtime: ProcessRuntime,
  bpmnProcessId: VersionSummary["definition"]["bpmnProcessId"],
): Promise<VersionSummary[]> {
  const tenants = (await runtime.listDefinitions())
    .filter((summary) => summary.latest.bpmnProcessId === bpmnProcessId)
    .map((summary) => summary.latest.tenantId)
  const versions = await Promise.all(
    tenants.map((tenantId) => runtime.listVersions(bpmnProcessId, tenantId)),
  )
  return versions.flat().sort((left, right) => right.definition.version - left.definition.version)
}

function foldedTenants(summaries: readonly DefinitionSummary[]): DefinitionSummary[] {
  const byKey = new Map<string, DefinitionSummary>()
  for (const summary of summaries) {
    const known = byKey.get(summary.latest.bpmnProcessId)
    if (known === undefined || known.latest.version < summary.latest.version) {
      byKey.set(summary.latest.bpmnProcessId, summary)
    }
  }
  return [...byKey.values()]
}

const SABOTAGES: readonly (readonly [string, Sabotage, readonly TenantCaseName[]])[] = [
  [
    "a key's processes in its tenants are one, by the newest version of any of them",
    (runtime) => ({
      listDefinitions: async () => foldedTenants(await runtime.listDefinitions()),
    }),
    [TENANT_CASE.tenantsApart],
  ],
  [
    "a process's versions are those of every tenant",
    (runtime) => ({
      listVersions: (bpmnProcessId) => everyTenantOf(runtime, bpmnProcessId),
    }),
    [TENANT_CASE.tenantVersions],
  ],
  [
    "a version names no tenant, as an engine without tenants would",
    (runtime) => ({
      listDefinitions: async () =>
        (await runtime.listDefinitions()).map((summary) => ({
          ...summary,
          latest: { ...summary.latest, tenantId: null },
        })),
    }),
    [TENANT_CASE.tenantsApart],
  ],
  [
    "a call starts the newest version of the called key in any tenant",
    (runtime) => ({
      getCalledProcesses: async (definition) => {
        const calls = await runtime.getCalledProcesses(definition)
        return Promise.all(
          calls.map(async (call) => {
            const [newest] = await everyTenantOf(runtime, call.bpmnProcessId)
            return newest === undefined ? call : { ...call, definition: newest.definition }
          }),
        )
      },
    }),
    [TENANT_CASE.tenantCalls],
  ],
  [
    "a call resolves in no tenant, whatever its caller's",
    (runtime) => ({
      getCalledProcesses: (definition) =>
        runtime.getCalledProcesses({ id: definition.id, tenantId: null }),
    }),
    [TENANT_CASE.tenantCalls],
  ],
]

describe("the tenant laws", () => {
  test("hold on the fake seeded with the world and its tenants", async () => {
    expect(await failingCases(harnessWith())).toEqual([])
  })

  test.each(SABOTAGES)("catch a runtime where %s", async (_flaw, sabotage, expected) => {
    expect(await failingCases(harnessWith(sabotage))).toEqual([...expected].sort())
  })

  test("leave the read laws holding on the fake with the tenants beside the world", async () => {
    const { state, world } = FakeWorld.seedWithTenants()
    const harness = {
      runtime: new FakeEngine(state),
      unreachableRuntime: FailingRuntime.unreachable("http://unreachable.invalid"),
      world,
    }
    const failing: string[] = []
    for (const law of ConformanceKit.runtimeLaws()) {
      await law.run(harness).catch(() => failing.push(law.name))
    }
    expect(failing).toEqual([])
  })

  test("register under the runner's name, sharing one prepared harness", async () => {
    const names: string[] = []
    const bodies: (() => Promise<void>)[] = []
    let prepared = 0
    new ConformanceKit((name, body) => {
      names.push(name)
      bodies.push(body)
    }).registerTenantLaws(() => {
      prepared += 1
      return Promise.resolve(harnessWith())
    })
    for (const body of bodies) {
      await body()
    }
    expect(names).toEqual(ConformanceKit.tenantLaws().map((law) => `conformance: ${law.name}`))
    expect(prepared).toBe(1)
  })
})
