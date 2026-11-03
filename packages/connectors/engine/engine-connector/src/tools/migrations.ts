import { createMigrationPlanInput, migrateProcessInstancesAsyncInput } from "../schemas/index.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { queuedBatch, type Client } from "@miragon/pulse-engine-client"
import { generateMigrationPlan, executeMigrationPlanAsync } from "@miragon/pulse-engine-client/sdk"
import type { MigrationInstructionDto } from "@miragon/pulse-engine-client/types"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"

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

export function registerMigrationTools(register: ToolRegistrar<EngineRegistry>) {
  register({
    name: "engine_create_migration_plan",
    category: "migrations",
    description:
      "Generate a migration plan from a source process definition to a target process definition. The plan contains activity-id mappings for activities that exist in both versions; pass it verbatim to engine_migrate_process_instances_async.",
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
    name: "engine_migrate_process_instances_async",
    category: "migrations",
    description:
      "Queue a batch that migrates process instances to another definition version (mapping generated from equal " +
      'activity ids unless instructions are given). Returns { batchId, status: "queued" }, not the outcome: ' +
      "follow it with engine_get_batch.",
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
