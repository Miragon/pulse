/**
 * The Camunda 7 conformance world as the seed reads it: structural copies of the world types of
 * @miragon/pulse-engine-core/testing (its WORLD_* values fit them as they are), the engine a seed
 * talks to and the plain string ids it hands back, which the caller brands into engine-core's
 * SeededWorld and CommandWorld.
 */

/** A variable's value in the world; a date is `{ date }`, an ISO 8601 instant in UTC. */
export type C7WorldValue = string | number | null | { readonly date: string }

/** A deployment of the world: its alias (`order@1`) and the process whose diagram it deploys. */
export interface C7WorldDeployment<Alias extends string = string> {
  readonly alias: Alias
  readonly process: string
}

/** An instance of the world: its business key, the deployment it starts on, its variables. */
export interface C7WorldInstance<
  Alias extends string = string,
  Deployment extends string = string,
> {
  readonly businessKey: Alias
  readonly deployment: Deployment
  readonly variables: Readonly<Record<string, C7WorldValue>>
}

/**
 * The world of the read laws: engine-core's WORLD_DEPLOYMENTS, WORLD_INSTANCES and
 * WORLD_LOCAL_VARIABLE, and the diagram text of each process by its name (`order`).
 */
export interface C7WorldPlan<Deployment extends string, Instance extends string> {
  readonly deployments: readonly C7WorldDeployment<Deployment>[]
  readonly instances: readonly C7WorldInstance<Instance, Deployment>[]
  readonly localVariable: {
    readonly instance: NoInfer<Instance>
    readonly name: string
    readonly value: string
  }
  readonly diagrams: Readonly<Record<string, string>>
}

/**
 * The world of the command laws: engine-core's WORLD_COMMAND_INSTANCES, WORLD_SECOND_TOKEN,
 * WORLD_BULK_INSTANCES and WORLD_MIGRATION_INSTANCES.
 */
export interface C7CommandWorldPlan<
  Deployment extends string,
  Command extends string,
  BulkSet extends string,
  MigrationSet extends string,
> {
  readonly instances: readonly C7WorldInstance<Command, Deployment>[]
  readonly secondToken: { readonly instance: NoInfer<Command>; readonly elementId: string }
  readonly bulk: Readonly<Record<BulkSet, readonly C7WorldInstance<string, Deployment>[]>>
  readonly migration: Readonly<Record<MigrationSet, readonly C7WorldInstance<string, Deployment>[]>>
}

/** Ids no engine of the world assigned, the same in every seeded world. */
export interface C7UnknownIds {
  readonly definitionId: string
  readonly instanceId: string
  readonly incidentId: string
  readonly bulkOperationId: string
}

/** The seeded read world: the engine's id of each deployment and instance, by alias. */
export interface C7SeededWorld<Deployment extends string, Instance extends string> {
  readonly definitionIds: Readonly<Record<Deployment, string>>
  readonly instanceIds: Readonly<Record<Instance, string>>
  readonly unknown: C7UnknownIds
}

/** The seeded command world: the engine's ids of its instances, by alias or by set. */
export interface C7CommandWorld<
  Deployment extends string,
  Command extends string,
  BulkSet extends string,
  MigrationSet extends string,
> {
  readonly instanceIds: Readonly<Record<Command, string>>
  readonly bulkInstanceIds: Readonly<Record<BulkSet, readonly string[]>>
  readonly migrationInstanceIds: Readonly<Record<MigrationSet, readonly string[]>>
  readonly definitionIds: Readonly<Record<Deployment, string>>
  readonly unknown: C7UnknownIds
}

/** A request of the seed, in the shape `fetch` takes. */
export interface C7SeedRequest {
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

/** What the seed reads of an answer: the part of a `fetch` Response it needs. */
export interface C7SeedAnswer {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

/**
 * The engine a seed talks to: its REST root (`http://localhost:8080/engine-rest`), a
 * fetch-shaped `send` (a GET goes without a request) and the `wait` between two polls.
 */
export interface C7SeedEngine {
  readonly url: string
  send(url: string, request?: C7SeedRequest): Promise<C7SeedAnswer>
  wait(ms: number): Promise<void>
}
