import { describe, expect, test } from "vitest"
import {
  RuntimeError,
  ValueKinds,
  type BulkOperationId,
  type ProcessCommands,
} from "../../src/contract/index.js"
import {
  COMMAND_CASE,
  ConformanceKit,
  WORLD_ELEMENT,
  type CommandCaseName,
  type CommandHarness,
} from "../../src/contract/conformance/index.js"
import { ElementId } from "../../src/contract/index.js"
import {
  FakeEngine,
  FakeWorld,
  PatchedCommands,
  PatchedRuntime,
} from "../../src/contract/fake/index.js"

type Sabotage = (commands: ProcessCommands, harness: CommandHarness) => Partial<ProcessCommands>

const WORKS_OFF_WITHIN = { withinMs: 2_000, wait: () => Promise.resolve() }

function conformingHarness(): CommandHarness {
  const { state, world } = FakeWorld.seedForCommands()
  const engine = new FakeEngine(state)
  return { runtime: engine, commands: engine, world, asyncWork: WORKS_OFF_WITHIN }
}

function sabotaged(sabotage: Sabotage): CommandHarness {
  const harness = conformingHarness()
  return {
    ...harness,
    commands: new PatchedCommands(harness.commands, sabotage(harness.commands, harness)),
  }
}

async function failingCases(harness: CommandHarness): Promise<CommandCaseName[]> {
  const failing: CommandCaseName[] = []
  for (const conformanceCase of ConformanceKit.commandLaws()) {
    await conformanceCase
      .run(harness)
      .catch(() => failing.push(conformanceCase.name as CommandCaseName))
  }
  return failing.sort()
}

const SABOTAGES: readonly (readonly [string, Sabotage, readonly CommandCaseName[]])[] = [
  [
    "a retry closes every open incident",
    (commands, harness) => ({
      retryIncident: async (incidentId) => {
        const page = await harness.runtime.searchIncidents({}, { limit: 50 })
        for (const incident of page.items) {
          await commands.retryIncident(incident.id)
        }
        if (!page.items.some((incident) => incident.id === incidentId)) {
          throw new RuntimeError("rejected", "not open")
        }
      },
    }),
    [COMMAND_CASE.retryClosesIncident, COMMAND_CASE.retryRejected],
  ],
  [
    "a retry of a closed incident is silently ignored",
    (commands) => ({
      retryIncident: (incidentId) => commands.retryIncident(incidentId).catch(() => undefined),
    }),
    [COMMAND_CASE.retryRejected],
  ],
  [
    "a changed variable is stored as text",
    (commands) => ({
      setVariable: (instanceId, change) =>
        commands.setVariable(instanceId, {
          ...change,
          valueJson: JSON.stringify(change.valueJson),
        }),
    }),
    [COMMAND_CASE.variableReadsBack, COMMAND_CASE.variableLossless],
  ],
  [
    "numbers pass through a double",
    (commands) => ({
      setVariable: (instanceId, change) =>
        commands.setVariable(instanceId, {
          ...change,
          valueJson: /^\d+$/.test(change.valueJson)
            ? String(Number(change.valueJson))
            : change.valueJson,
        }),
    }),
    [COMMAND_CASE.variableLossless],
  ],
  [
    "unknown and ended instances fail as engine failures",
    (commands) => ({
      setVariable: (instanceId, change) =>
        commands.setVariable(instanceId, change).catch(() => {
          throw new RuntimeError("engineFailure", "boom")
        }),
    }),
    [COMMAND_CASE.variableRejected],
  ],
  [
    "a move cancels its source without starting its target",
    (commands) => ({
      moveToken: (instanceId, move) =>
        commands.moveToken(instanceId, {
          ...move,
          toElementId: ElementId(WORLD_ELEMENT.orderReviewed),
        }),
    }),
    [COMMAND_CASE.moveSkips, COMMAND_CASE.moveReruns],
  ],
  [
    "a refused move is silently ignored",
    (commands) => ({
      moveToken: (instanceId, move) => commands.moveToken(instanceId, move).catch(() => undefined),
    }),
    [COMMAND_CASE.moveRejected],
  ],
  [
    "a move without a reason goes through",
    (commands) => ({
      moveToken: (instanceId, move) =>
        commands.moveToken(instanceId, {
          ...move,
          reason: move.reason.trim() === "" ? "filled in" : move.reason,
        }),
    }),
    [COMMAND_CASE.moveRejected],
  ],
]

type HarnessSabotage = (harness: CommandHarness) => CommandHarness

const BULK_SABOTAGES: readonly (readonly [string, HarnessSabotage, readonly CommandCaseName[]])[] =
  [
    [
      "cancelling sends the query instead of the ids",
      (harness) => ({
        ...harness,
        commands: new PatchedCommands(harness.commands, {
          cancelInstances: async (instanceIds, options) => {
            const first = await harness.runtime.getInstanceDetail(instanceIds[0]!)
            const page = await harness.runtime.searchInstances(
              { definitionId: first!.instance.definition.id, lifecycle: "running" },
              { limit: 500 },
            )
            return harness.commands.cancelInstances(
              page.items.map((instance) => instance.id),
              options,
            )
          },
        }),
      }),
      [COMMAND_CASE.bulkCancelEndsExactly, COMMAND_CASE.bulkSkipsEnded, COMMAND_CASE.bulkStopHalts],
    ],
    [
      "a Stop is acknowledged but ignored",
      (harness) => ({
        ...harness,
        commands: new PatchedCommands(harness.commands, {
          stopBulkOperation: () => Promise.resolve(),
        }),
      }),
      [COMMAND_CASE.bulkStopHalts, COMMAND_CASE.bulkUnknown],
    ],
    [
      "an instance that already ended rejects the whole operation",
      (harness) => ({
        ...harness,
        commands: new PatchedCommands(harness.commands, {
          cancelInstances: async (instanceIds, options) => {
            const running = await harness.runtime.countInstances({
              instanceIds,
              lifecycle: "running",
            })
            if (running < instanceIds.length) {
              throw new RuntimeError("rejected", "not running")
            }
            return harness.commands.cancelInstances(instanceIds, options)
          },
        }),
      }),
      [COMMAND_CASE.bulkSkipsEnded],
    ],
    [
      "instances that already ended count as failed",
      (harness) => {
        const skipped = new Map<BulkOperationId, number>()
        return {
          ...harness,
          commands: new PatchedCommands(harness.commands, {
            cancelInstances: async (instanceIds, options) => {
              const running = await harness.runtime.countInstances({
                instanceIds,
                lifecycle: "running",
              })
              const id = await harness.commands.cancelInstances(instanceIds, options)
              skipped.set(id, instanceIds.length - running)
              return id
            },
          }),
          runtime: new PatchedRuntime(harness.runtime, {
            getBulkOperation: async (id) => {
              const operation = await harness.runtime.getBulkOperation(id)
              const failed = skipped.get(id)
              return operation === undefined || failed === undefined
                ? operation
                : { ...operation, completed: (operation.completed ?? 0) - failed, failed }
            },
          }),
        }
      },
      [COMMAND_CASE.bulkSkipsEnded],
    ],
    [
      "progress is counted in jobs of two items each",
      (harness) => ({
        ...harness,
        runtime: new PatchedRuntime(harness.runtime, {
          getBulkOperation: async (id) => {
            const operation = await harness.runtime.getBulkOperation(id)
            return operation === undefined
              ? undefined
              : { ...operation, completed: (operation.completed ?? 0) * 2 }
          },
        }),
      }),
      [COMMAND_CASE.bulkCancelEndsExactly, COMMAND_CASE.bulkSkipsEnded],
    ],
    [
      "an unknown operation fails as an engine failure",
      (harness) => ({
        ...harness,
        runtime: new PatchedRuntime(harness.runtime, {
          getBulkOperation: async (id) => {
            const operation = await harness.runtime.getBulkOperation(id)
            if (operation === undefined) {
              throw new RuntimeError("engineFailure", "boom")
            }
            return operation
          },
        }),
      }),
      [COMMAND_CASE.bulkUnknown],
    ],
    [
      "stopping an unknown operation passes silently",
      (harness) => ({
        ...harness,
        commands: new PatchedCommands(harness.commands, {
          stopBulkOperation: (id) => harness.commands.stopBulkOperation(id).catch(() => undefined),
        }),
      }),
      [COMMAND_CASE.bulkUnknown],
    ],
    [
      "a migration drops the first mapping of its plan",
      (harness) => ({
        ...harness,
        commands: new PatchedCommands(harness.commands, {
          migrateInstances: (plan, instanceIds) =>
            harness.commands.migrateInstances(
              { ...plan, mappings: plan.mappings.slice(1) },
              instanceIds,
            ),
        }),
      }),
      [
        COMMAND_CASE.migrationMovesExactly,
        COMMAND_CASE.migrationReportsFailures,
        COMMAND_CASE.migrationSkipsEnded,
      ],
    ],
    [
      "a migration sends the query instead of the ids",
      (harness) => ({
        ...harness,
        commands: new PatchedCommands(harness.commands, {
          migrateInstances: async (plan, instanceIds) => {
            const page = await harness.runtime.searchInstances(
              { definitionId: plan.sourceDefinitionId, lifecycle: "running" },
              { limit: 500 },
            )
            const query = page.items.map((instance) => instance.id)
            return harness.commands.migrateInstances(plan, [...instanceIds, ...query])
          },
        }),
      }),
      [
        COMMAND_CASE.migrationMovesExactly,
        COMMAND_CASE.migrationReportsFailures,
        COMMAND_CASE.migrationSkipsEnded,
      ],
    ],
    [
      "migrated instances that already ended count as failed",
      (harness) => {
        const skipped = new Map<BulkOperationId, number>()
        return {
          ...harness,
          commands: new PatchedCommands(harness.commands, {
            migrateInstances: async (plan, instanceIds) => {
              const running = await harness.runtime.countInstances({
                instanceIds,
                definitionId: plan.sourceDefinitionId,
                lifecycle: "running",
              })
              const id = await harness.commands.migrateInstances(plan, instanceIds)
              skipped.set(id, instanceIds.length - running)
              return id
            },
          }),
          runtime: new PatchedRuntime(harness.runtime, {
            getBulkOperation: async (id) => {
              const operation = await harness.runtime.getBulkOperation(id)
              const failed = skipped.get(id)
              return operation === undefined || failed === undefined
                ? operation
                : { ...operation, failed: (operation.failed ?? 0) + failed }
            },
          }),
        }
      },
      [COMMAND_CASE.migrationSkipsEnded],
    ],
    [
      "a migration reads as a cancellation",
      (harness) => ({
        ...harness,
        runtime: new PatchedRuntime(harness.runtime, {
          getBulkOperation: async (id) => {
            const operation = await harness.runtime.getBulkOperation(id)
            return operation && { ...operation, kind: "cancelInstances" }
          },
        }),
      }),
      [
        COMMAND_CASE.migrationMovesExactly,
        COMMAND_CASE.migrationReportsFailures,
        COMMAND_CASE.migrationSkipsEnded,
      ],
    ],
    [
      "a migration drops the incident of the instances it moves",
      (harness) => ({
        ...harness,
        runtime: new PatchedRuntime(harness.runtime, {
          getInstanceDetail: async (instanceId) => {
            const detail = await harness.runtime.getInstanceDetail(instanceId)
            const moved = detail?.instance.definition.id === harness.world.definitionIds["order@2"]
            return detail === undefined || !moved
              ? detail
              : { ...detail, instance: { ...detail.instance, hasIncident: false } }
          },
        }),
      }),
      [COMMAND_CASE.migrationMovesExactly],
    ],
    [
      "a failed migration names no reason",
      (harness) => ({
        ...harness,
        runtime: new PatchedRuntime(harness.runtime, {
          getBulkFailures: () => Promise.resolve([]),
        }),
      }),
      [COMMAND_CASE.migrationReportsFailures],
    ],
    [
      "a migration failure names an instance that was not submitted",
      (harness) => ({
        ...harness,
        runtime: new PatchedRuntime(harness.runtime, {
          getBulkFailures: async (id) =>
            (await harness.runtime.getBulkFailures(id)).map((failure) => ({
              ...failure,
              instanceId: harness.world.unknown.instanceId,
            })),
        }),
      }),
      [COMMAND_CASE.migrationReportsFailures],
    ],
  ]

describe("the conforming fake commands", () => {
  new ConformanceKit(test).registerCommandLaws(() => Promise.resolve(conformingHarness()))

  test("fail no case", async () => {
    expect(await failingCases(conformingHarness())).toEqual([])
  })
})

describe("the command kit", () => {
  test("pins every case name", () => {
    expect(
      ConformanceKit.commandLaws()
        .map((conformanceCase) => conformanceCase.name)
        .sort(),
    ).toEqual(Object.values(COMMAND_CASE).sort())
  })

  test.each(SABOTAGES)("catches commands where %s", async (_flaw, sabotage, expected) => {
    expect(await failingCases(sabotaged(sabotage))).toEqual([...expected].sort())
  })

  test.each(BULK_SABOTAGES)(
    "catches bulk operations where %s",
    async (_flaw, sabotage, expected) => {
      expect(await failingCases(sabotage(conformingHarness()))).toEqual([...expected].sort())
    },
  )

  test("fails the bulk work without a declared time for asynchronous work", async () => {
    const { runtime, commands, world } = conformingHarness()
    expect(await failingCases({ runtime, commands, world })).toEqual([
      COMMAND_CASE.bulkCancelEndsExactly,
    ])
  })
})

const STALE_READS_AFTER_A_WRITE = 3
const VISIBLE_WITHIN = { withinMs: 2_000, wait: () => Promise.resolve() }

function lagging(): CommandHarness {
  const harness = conformingHarness()
  const lastSeen = new Map<string, unknown>()
  let staleReads = 0
  const stale = <Result>(key: string, read: () => Promise<Result>): Promise<Result> => {
    if (staleReads > 0 && lastSeen.has(key)) {
      staleReads -= 1
      return Promise.resolve(lastSeen.get(key) as Result)
    }
    return read().then((result) => {
      lastSeen.set(key, result)
      return result
    })
  }
  const written = (write: Promise<void>) =>
    write.then(() => {
      staleReads = STALE_READS_AFTER_A_WRITE
    })
  return {
    ...harness,
    runtime: new PatchedRuntime(harness.runtime, {
      searchIncidents: (filter, page) =>
        stale(`incidents ${JSON.stringify(filter)}`, () =>
          harness.runtime.searchIncidents(filter, page),
        ),
      getInstanceDetail: (instanceId) =>
        stale(`detail ${instanceId}`, () => harness.runtime.getInstanceDetail(instanceId)),
    }),
    commands: new PatchedCommands(harness.commands, {
      retryIncident: (incidentId) => written(harness.commands.retryIncident(incidentId)),
      setVariable: (instanceId, change) =>
        written(harness.commands.setVariable(instanceId, change)),
      moveToken: (instanceId, move) => written(harness.commands.moveToken(instanceId, move)),
    }),
  }
}

describe("an engine that reports no total before it has set an operation up", () => {
  test("passes the migration laws once its counts arrive", async () => {
    const harness = conformingHarness()
    const settingUp = new Set<BulkOperationId>()
    const engine: CommandHarness = {
      ...harness,
      commands: new PatchedCommands(harness.commands, {
        migrateInstances: async (plan, instanceIds) => {
          const id = await harness.commands.migrateInstances(plan, instanceIds)
          settingUp.add(id)
          return id
        },
      }),
      runtime: new PatchedRuntime(harness.runtime, {
        getBulkOperation: (id) => {
          if (!settingUp.delete(id)) {
            return harness.runtime.getBulkOperation(id)
          }
          return Promise.resolve({
            id,
            kind: "migrateInstances",
            state: "running",
            total: 0,
            completed: 0,
            failed: 0,
          })
        },
      }),
    }

    expect(await failingCases(engine)).toEqual([])
  })
})

describe("reads that lag behind writes", () => {
  test("fail every read-back without a declared write visibility", async () => {
    expect(await failingCases(lagging())).toEqual(
      [
        COMMAND_CASE.retryClosesIncident,
        COMMAND_CASE.variableReadsBack,
        COMMAND_CASE.variableLossless,
        COMMAND_CASE.moveSkips,
        COMMAND_CASE.moveReruns,
      ].sort(),
    )
  })

  test("pass once the harness declares how long a write may take to show", async () => {
    expect(await failingCases({ ...lagging(), writeVisibility: VISIBLE_WITHIN })).toEqual([])
  })

  test("do not wait out an engine error", async () => {
    const harness = conformingHarness()
    const failing: CommandHarness = {
      ...harness,
      runtime: new PatchedRuntime(harness.runtime, {
        getInstanceDetail: () => Promise.reject(new RuntimeError("engineFailure", "boom")),
      }),
      writeVisibility: { withinMs: 60_000, wait: () => Promise.reject(new Error("waited")) },
    }
    const lossless = ConformanceKit.commandLaws().find(
      (conformanceCase) => conformanceCase.name === COMMAND_CASE.variableLossless,
    )
    await expect(lossless!.run(failing)).rejects.toMatchObject({ failure: "engineFailure" })
  })
})

describe("a move that starts its target but keeps its source", () => {
  test("fails only the skip law", async () => {
    const harness = conformingHarness()
    const skipped = harness.world.instanceIds["CMD-SKIP"]
    const kept = {
      kind: "asyncContinuation",
      instanceId: skipped,
      elementId: ElementId(WORLD_ELEMENT.chargePayment),
      retriesLeft: 0,
    } as const
    const keepsSource: CommandHarness = {
      ...harness,
      runtime: new PatchedRuntime(harness.runtime, {
        getInstanceDetail: async (instanceId) => {
          const detail = await harness.runtime.getInstanceDetail(instanceId)
          if (instanceId !== skipped || detail === undefined) {
            return detail
          }
          const moved = detail.waitStates.every((wait) => wait.elementId !== kept.elementId)
          return moved ? { ...detail, waitStates: [...detail.waitStates, kept] } : detail
        },
      }),
    }
    expect(await failingCases(keepsSource)).toEqual([COMMAND_CASE.moveSkips])
  })
})

describe("the kind of a JSON value", () => {
  test.each([
    ['"text"', "string"],
    ["42", "integer"],
    ["-4.5e3", "decimal"],
    ["true", "boolean"],
    ["null", "null"],
    ['{"a":1}', "json"],
    ["[1]", "json"],
  ])("%s is %s", (valueJson, kind) => {
    expect(ValueKinds.ofJson(valueJson)).toBe(kind)
  })
})

describe("a retried fake incident", () => {
  test("leaves its wait state ready for another attempt and clears the incident flag", async () => {
    const harness = conformingHarness()
    const instanceId = harness.world.instanceIds["CMD-RETRY"]
    const [incident] = (await harness.runtime.searchIncidents({ instanceId }, { limit: 5 })).items
    await harness.commands.retryIncident(incident!.id)
    const detail = await harness.runtime.getInstanceDetail(instanceId)
    expect(detail?.instance.hasIncident).toBe(false)
    expect(detail?.waitStates).toEqual([
      expect.objectContaining({ kind: "asyncContinuation", retriesLeft: 1 }),
    ])
    expect(detail?.waitStates[0]).not.toHaveProperty("incidentId")
  })
})
