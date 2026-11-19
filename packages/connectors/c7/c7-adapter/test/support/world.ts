import {
  seedC7CommandWorld,
  seedC7World,
  type C7SeedEngine,
  type C7UnknownIds,
} from "@miragon/pulse-c7-core/testing"
import { BulkOperationId, DefinitionId, IncidentId, InstanceId } from "@miragon/pulse-engine-core"
import {
  WORLD_BULK_INSTANCES,
  WORLD_COMMAND_INSTANCES,
  WORLD_DEPLOYMENTS,
  WORLD_INSTANCES,
  WORLD_LOCAL_VARIABLE,
  WORLD_MIGRATION_INSTANCES,
  WORLD_SECOND_TOKEN,
  type CommandWorld,
  type SeededWorld,
} from "@miragon/pulse-engine-core/testing"
import { worldDiagram } from "./fixtures.js"

function engineAt(url: string): C7SeedEngine {
  return {
    url,
    send: (target, request) => fetch(target, request),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

function branded<Key extends string, Plain, Id>(
  ids: Readonly<Record<Key, Plain>>,
  brand: (id: Plain) => Id,
): Record<Key, Id> {
  const entries = Object.entries<Plain>(ids).map(([key, id]) => [key, brand(id)])
  return Object.fromEntries(entries) as Record<Key, Id>
}

function instanceIdsOf(ids: readonly string[]): InstanceId[] {
  return ids.map((id) => InstanceId(id))
}

function unknownOf(unknown: C7UnknownIds): SeededWorld["unknown"] {
  return {
    definitionId: DefinitionId(unknown.definitionId),
    instanceId: InstanceId(unknown.instanceId),
    incidentId: IncidentId(unknown.incidentId),
    bulkOperationId: BulkOperationId(unknown.bulkOperationId),
  }
}

export async function seedWorld(engineUrl: string): Promise<SeededWorld> {
  const diagrams = Object.fromEntries(
    WORLD_DEPLOYMENTS.map(({ process }) => [process, worldDiagram(process)]),
  )
  const world = await seedC7World(engineAt(engineUrl), {
    deployments: WORLD_DEPLOYMENTS,
    instances: WORLD_INSTANCES,
    localVariable: WORLD_LOCAL_VARIABLE,
    diagrams,
  })
  return {
    definitionIds: branded(world.definitionIds, DefinitionId),
    instanceIds: branded(world.instanceIds, InstanceId),
    unknown: unknownOf(world.unknown),
  }
}

export async function seedCommandWorld(
  engineUrl: string,
  seeded: SeededWorld,
): Promise<CommandWorld> {
  const world = await seedC7CommandWorld(
    engineAt(engineUrl),
    {
      instances: WORLD_COMMAND_INSTANCES,
      secondToken: WORLD_SECOND_TOKEN,
      bulk: WORLD_BULK_INSTANCES,
      migration: WORLD_MIGRATION_INSTANCES,
    },
    seeded,
  )
  return {
    instanceIds: branded(world.instanceIds, InstanceId),
    bulkInstanceIds: branded(world.bulkInstanceIds, instanceIdsOf),
    migrationInstanceIds: branded(world.migrationInstanceIds, instanceIdsOf),
    definitionIds: seeded.definitionIds,
    unknown: unknownOf(world.unknown),
  }
}
