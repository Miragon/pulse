/**
 * The seed of the Camunda 7 conformance world: deploys its diagrams into a C7 engine of the
 * family and starts its instances over the REST API, so the conformance kit of
 * @miragon/pulse-engine-core reads and writes the same world on every C7 wire.
 */

import type {
  C7CommandWorld,
  C7CommandWorldPlan,
  C7SeedEngine,
  C7SeededWorld,
  C7UnknownIds,
  C7WorldDeployment,
  C7WorldInstance,
  C7WorldPlan,
} from "./c7-world.js"
import { addLocalVariable, addSecondToken, deploy, start, waitForIncidents } from "./seed-calls.js"

const DEPLOYMENT_ORDER = ["label@1", "order@1", "order@2", "dispatch@1"]
const EXPECTED_ROOT_INCIDENTS = 2
const FAILING_ROUTE = "charge"

const UNKNOWN_IDS: C7UnknownIds = {
  definitionId: "pulse-unknown:1:00000000-0000-4000-8000-000000000001",
  instanceId: "00000000-0000-4000-8000-000000000002",
  incidentId: "00000000-0000-4000-8000-000000000003",
  bulkOperationId: "00000000-0000-4000-8000-000000000004",
}

function deploymentOf<Deployment extends string>(
  deployments: readonly C7WorldDeployment<Deployment>[],
  alias: string,
): C7WorldDeployment<Deployment> {
  const deployment = deployments.find((candidate) => candidate.alias === alias)
  if (deployment === undefined) {
    throw new Error(`the world has no deployment ${alias}`)
  }
  return deployment
}

function diagramOf(diagrams: Readonly<Record<string, string>>, process: string): string {
  const diagram = diagrams[process]
  if (diagram === undefined) {
    throw new Error(`the world has no diagram of ${process}`)
  }
  return diagram
}

async function deployWorld<Deployment extends string>(
  engine: C7SeedEngine,
  plan: C7WorldPlan<Deployment, string>,
): Promise<Record<Deployment, string>> {
  const definitionIds: Partial<Record<Deployment, string>> = {}
  for (const alias of DEPLOYMENT_ORDER) {
    const deployment = deploymentOf(plan.deployments, alias)
    definitionIds[deployment.alias] = await deploy(
      engine,
      deployment,
      diagramOf(plan.diagrams, deployment.process),
    )
  }
  return definitionIds as Record<Deployment, string>
}

async function startEach<Alias extends string, Deployment extends string>(
  engine: C7SeedEngine,
  instances: readonly C7WorldInstance<Alias, Deployment>[],
  definitionIds: Readonly<Record<Deployment, string>>,
): Promise<Record<Alias, string>> {
  const instanceIds: Partial<Record<Alias, string>> = {}
  for (const instance of instances) {
    instanceIds[instance.businessKey] = await start(
      engine,
      instance,
      definitionIds[instance.deployment],
    )
  }
  return instanceIds as Record<Alias, string>
}

async function startSets<Set extends string, Deployment extends string>(
  engine: C7SeedEngine,
  sets: Readonly<Record<Set, readonly C7WorldInstance<string, Deployment>[]>>,
  definitionIds: Readonly<Record<Deployment, string>>,
): Promise<Record<Set, string[]>> {
  const instanceIds: Partial<Record<Set, string[]>> = {}
  for (const set of Object.keys(sets) as Set[]) {
    instanceIds[set] = await Promise.all(
      sets[set].map((instance) => start(engine, instance, definitionIds[instance.deployment])),
    )
  }
  return instanceIds as Record<Set, string[]>
}

/**
 * Seeds the world of the read laws: deploys label@1, order@1, order@2 and dispatch@1 in this
 * order, starts the instances one by one, sets the local variable on its instance's task and
 * waits for the world's two root incidents. Answers the engine's ids by alias and fixed unknown
 * ids, as plain strings.
 */
export async function seedC7World<Deployment extends string, Instance extends string>(
  engine: C7SeedEngine,
  plan: C7WorldPlan<Deployment, Instance>,
): Promise<C7SeededWorld<Deployment, Instance>> {
  const definitionIds = await deployWorld(engine, plan)
  const instanceIds = await startEach(engine, plan.instances, definitionIds)
  await addLocalVariable(engine, instanceIds[plan.localVariable.instance], plan.localVariable)
  await waitForIncidents(engine, EXPECTED_ROOT_INCIDENTS)
  return { definitionIds, instanceIds, unknown: UNKNOWN_IDS }
}

/**
 * Seeds the world of the command laws on a seeded read world: starts the command instances one
 * by one, the second token, the migration sets one after the other (each set's instances at
 * once), waits until every instance on the failing route has its root incident, then starts the
 * bulk sets the same way.
 */
export async function seedC7CommandWorld<
  Deployment extends string,
  Command extends string,
  BulkSet extends string,
  MigrationSet extends string,
>(
  engine: C7SeedEngine,
  plan: C7CommandWorldPlan<Deployment, Command, BulkSet, MigrationSet>,
  world: { readonly definitionIds: Readonly<Record<Deployment, string>> },
): Promise<C7CommandWorld<Deployment, Command, BulkSet, MigrationSet>> {
  const instanceIds = await startEach(engine, plan.instances, world.definitionIds)
  await addSecondToken(engine, instanceIds[plan.secondToken.instance], plan.secondToken.elementId)
  const migrationInstanceIds = await startSets(engine, plan.migration, world.definitionIds)
  const migrating = Object.values<readonly C7WorldInstance[]>(plan.migration).flat()
  const failing = [...plan.instances, ...migrating]
  await waitForIncidents(
    engine,
    EXPECTED_ROOT_INCIDENTS +
      failing.filter(({ variables }) => variables.route === FAILING_ROUTE).length,
  )
  return {
    instanceIds,
    bulkInstanceIds: await startSets(engine, plan.bulk, world.definitionIds),
    migrationInstanceIds,
    definitionIds: world.definitionIds,
    unknown: UNKNOWN_IDS,
  }
}
