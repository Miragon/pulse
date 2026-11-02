import { z } from "zod"

const migrationInstruction = z.object({
  sourceActivityIds: z.array(z.string()),
  targetActivityIds: z.array(z.string()),
  updateEventTrigger: z.boolean().optional(),
})

export const createMigrationPlanInput = z.object({
  sourceProcessDefinitionId: z.string(),
  targetProcessDefinitionId: z.string(),
  updateEventTriggers: z
    .boolean()
    .optional()
    .describe("If true, instructions between events are configured to update the event triggers."),
})

export const migrateProcessInstancesAsyncInput = z.object({
  sourceProcessDefinitionId: z.string(),
  targetProcessDefinitionId: z.string(),
  processInstanceIds: z.array(z.string()).min(1),
  instructions: z
    .array(migrationInstruction)
    .optional()
    .describe(
      "Explicit activity mappings. Omit to generate them from equal activity ids (as camunda7_create_migration_plan).",
    ),
  skipCustomListeners: z.boolean().optional(),
  skipIoMappings: z.boolean().optional(),
})
