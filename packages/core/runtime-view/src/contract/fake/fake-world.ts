import type { CommandWorld } from "../conformance/command-harness.js"
import type { SeededWorld } from "../conformance/harness.js"
import {
  WORLD_BULK_INSTANCES,
  WORLD_COMMAND_INSTANCES,
  WORLD_DEPLOYMENTS,
  WORLD_INSTANCES,
  WORLD_MIGRATION_INSTANCES,
  type DeploymentAlias,
  type MigrationSet,
  type WorldInstance,
} from "../conformance/world/world.js"
import { BulkOperationId, DefinitionId, IncidentId, InstanceId } from "../model/ids.js"
import type { FakeEngineState } from "./fake-engine-state.js"
import { FakeWorldSimulation, type AnyWorldInstance } from "./fake-world-simulation.js"

export interface FakeWorldSeed {
  readonly state: FakeEngineState
  readonly world: SeededWorld
}

export interface FakeCommandWorldSeed {
  readonly state: FakeEngineState
  readonly world: CommandWorld
}

const UNKNOWN = {
  definitionId: DefinitionId("unknown:1"),
  instanceId: InstanceId("unknown-instance"),
  incidentId: IncidentId("unknown-incident"),
  bulkOperationId: BulkOperationId("unknown-bulk"),
}

export class FakeWorld {
  static seed(): FakeWorldSeed {
    return {
      state: FakeWorld.stateOf(WORLD_INSTANCES),
      world: {
        definitionIds: FakeWorld.definitionIds(),
        instanceIds: FakeWorld.idsOf(WORLD_INSTANCES),
        unknown: UNKNOWN,
      },
    }
  }

  static seedForCommands(): FakeCommandWorldSeed {
    const { cancel, stop } = WORLD_BULK_INSTANCES
    const migration = Object.values(WORLD_MIGRATION_INSTANCES).flat()
    return {
      state: FakeWorld.stateOf([
        ...WORLD_INSTANCES,
        ...WORLD_COMMAND_INSTANCES,
        ...cancel,
        ...stop,
        ...migration,
      ]),
      world: {
        instanceIds: FakeWorld.idsOf(WORLD_COMMAND_INSTANCES),
        bulkInstanceIds: {
          cancel: Object.values(FakeWorld.idsOf(cancel)),
          stop: Object.values(FakeWorld.idsOf(stop)),
        },
        migrationInstanceIds: FakeWorld.migrationIds(),
        definitionIds: FakeWorld.definitionIds(),
        unknown: UNKNOWN,
      },
    }
  }

  private static definitionIds(): Record<DeploymentAlias, DefinitionId> {
    return Object.fromEntries(
      WORLD_DEPLOYMENTS.map(({ alias }) => [alias, FakeWorldSimulation.definitionOf(alias).ref.id]),
    ) as Record<DeploymentAlias, DefinitionId>
  }

  private static migrationIds(): Record<MigrationSet, readonly InstanceId[]> {
    const idsOf = (set: MigrationSet) =>
      Object.values(FakeWorld.idsOf(WORLD_MIGRATION_INSTANCES[set]))
    return {
      whole: idsOf("whole"),
      partial: idsOf("partial"),
      skip: idsOf("skip"),
      stay: idsOf("stay"),
    }
  }

  private static stateOf(instances: readonly AnyWorldInstance[]): FakeEngineState {
    const simulation = new FakeWorldSimulation()
    const simulated = instances.map((instance) => simulation.simulate(instance))
    return {
      engine: { product: "Fake engine", version: "1.0.0" },
      definitions: WORLD_DEPLOYMENTS.map(({ alias }) => FakeWorldSimulation.definitionOf(alias)),
      instances: simulated.flatMap((outcome) => outcome.instances),
      incidents: simulated.flatMap((outcome) => outcome.incidents),
    }
  }

  private static idsOf<Alias extends string>(
    instances: readonly WorldInstance<Alias>[],
  ): Record<Alias, InstanceId> {
    return Object.fromEntries(
      instances.map(({ businessKey }) => [businessKey, InstanceId(`fake-${businessKey}`)]),
    ) as Record<Alias, InstanceId>
  }
}
