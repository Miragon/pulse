import {
  createMigrationPlanInput,
  migrateProcessInstancesAsyncInput,
} from "@miragon/pulse-camunda7-client/schemas"
import type { createToolRegistrar } from "@miragon/mcp-toolkit-core/tools"
import { queuedBatch, type Client } from "@miragon/pulse-camunda7-client"
import {
  generateMigrationPlan,
  executeMigrationPlanAsync,
} from "@miragon/pulse-camunda7-client/sdk"
import type { MigrationInstructionDto } from "@miragon/pulse-camunda7-client/types"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"

type Register = ReturnType<typeof createToolRegistrar<EngineRegistry>>

/**
 * The execute endpoint does NOT derive a mapping: without instructions every instance with an
 * active activity fails its batch job, so omitted ones are generated first.
 */
async function migrationInstructions(
  client: Client,
  args: {
    sourceProcessDefinitionId: string
    targetProcessDefinitionId: string
    instructions?: MigrationInstructionDto[]
  },
): Promise<MigrationInstructionDto[]> {
  if (args.instructions) return args.instructions
  const plan = await generateMigrationPlan({
    client,
    body: {
      sourceProcessDefinitionId: args.sourceProcessDefinitionId,
      targetProcessDefinitionId: args.targetProcessDefinitionId,
    },
  })
  return plan.instructions ?? []
}

export function registerMigrationTools(register: Register) {
  register({
    name: "camunda7_create_migration_plan",
    category: "migrations",
    description:
      "Generate a migration plan from a source process definition to a target process definition. The plan contains activity-id mappings for activities that exist in both versions; pass it verbatim to camunda7_migrate_process_instances_async.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...createMigrationPlanInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      generateMigrationPlan({
        client,
        body: {
          sourceProcessDefinitionId: args.sourceProcessDefinitionId,
          targetProcessDefinitionId: args.targetProcessDefinitionId,
          updateEventTriggers: args.updateEventTriggers,
        },
      }),
    ),
  })

  register({
    name: "camunda7_migrate_process_instances_async",
    category: "migrations",
    description:
      "Queue a batch that migrates process instances to another definition version (mapping generated from equal " +
      'activity ids unless instructions are given). Returns { batchId, status: "queued" } — not the outcome: ' +
      "follow it with camunda7_get_batch.",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: { ...migrateProcessInstancesAsyncInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      const batch = await executeMigrationPlanAsync({
        client,
        body: {
          migrationPlan: {
            sourceProcessDefinitionId: args.sourceProcessDefinitionId,
            targetProcessDefinitionId: args.targetProcessDefinitionId,
            instructions: await migrationInstructions(client, args),
          },
          processInstanceIds: args.processInstanceIds,
          skipCustomListeners: args.skipCustomListeners,
          skipIoMappings: args.skipIoMappings,
        },
      })
      return { ...queuedBatch(batch), instanceCount: args.processInstanceIds.length }
    }),
  })
}
