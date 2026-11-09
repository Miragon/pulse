import { describe, expect, test } from "vitest"
import { RuntimeError, type BulkOperationId } from "../src/index.js"
import {
  COMMAND_CASE,
  ConformanceKit,
  PatchedCommands,
  PatchedRuntime,
  type CommandCaseName,
  type CommandHarness,
} from "../src/testing/index.js"
import { CommandHarnesses } from "./support/command-harnesses.js"
import { SabotagedRuntime } from "./support/sabotaged-runtime.js"

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
            const { count: running } = await harness.runtime.countInstances({
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
              const { count: running } = await harness.runtime.countInstances({
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
              const { count: running } = await harness.runtime.countInstances({
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

describe("the command kit", () => {
  test.each(BULK_SABOTAGES)(
    "catches bulk operations where %s",
    async (_flaw, sabotage, expected) => {
      expect(await CommandHarnesses.failingCases(sabotage(CommandHarnesses.conforming()))).toEqual(
        [...expected].sort(),
      )
    },
  )

  test("fails the bulk work without a declared time for asynchronous work", async () => {
    const { runtime, commands, world } = CommandHarnesses.conforming()
    expect(await CommandHarnesses.failingCases({ runtime, commands, world })).toEqual([
      COMMAND_CASE.bulkCancelEndsExactly,
    ])
  })
})

describe("an engine that migrates but plans no migrations", () => {
  test("fails exactly the migration laws, each under its own name", async () => {
    const harness = CommandHarnesses.conforming()
    const planless: CommandHarness = {
      ...harness,
      runtime: SabotagedRuntime.stripped(harness.runtime, ["proposeMigration", "checkMigration"]),
    }
    const migrations: readonly string[] = [
      COMMAND_CASE.migrationMovesExactly,
      COMMAND_CASE.migrationReportsFailures,
      COMMAND_CASE.migrationSkipsEnded,
    ]

    expect(await CommandHarnesses.failingCases(planless)).toEqual([...migrations].sort())
    for (const law of ConformanceKit.commandLaws()) {
      if (migrations.includes(law.name)) {
        await expect(law.run(planless)).rejects.toThrow(
          `${law.name}: an engine that migrates also proposes migration plans`,
        )
      }
    }
  })
})

describe("an engine that reports no total before it has set an operation up", () => {
  test("passes the migration laws once its counts arrive", async () => {
    const harness = CommandHarnesses.conforming()
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

    expect(await CommandHarnesses.failingCases(engine)).toEqual([])
  })
})
