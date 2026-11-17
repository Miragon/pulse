import { readFileSync } from "node:fs"
import {
  C8WorldSeed,
  type C8SeedAnswer,
  type C8SeedEngine,
  type C8SeedRequest,
} from "@miragon/pulse-c8-core/testing"
import { BulkOperationId, DefinitionId, IncidentId, InstanceId } from "@miragon/pulse-engine-core"
import {
  WORLD_DEPLOYMENTS,
  WORLD_INSTANCES,
  WORLD_LOCAL_VARIABLE,
  type SeededWorld,
} from "@miragon/pulse-engine-core/testing"
import type { EngineCredentials } from "@miragon/pulse-runtime-view/ports"
import { authorizationOf } from "./engine-container.js"

const SETTLED_WITHIN_MS = 120_000
const POLL_INTERVAL_MS = 250

export class ClusterCalls implements C8SeedEngine {
  constructor(
    readonly url: string,
    private readonly credentials: EngineCredentials,
  ) {}

  async send(target: string, request: C8SeedRequest): Promise<C8SeedAnswer> {
    const headers = { ...request.headers, ...(await authorizationOf(this.credentials)) }
    return fetch(target, { ...request, headers })
  }

  wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  now(): number {
    return Date.now()
  }

  post<Body>(path: string, body: unknown): Promise<Body> {
    return this.call<Body>(path, JSON.stringify(body), { "Content-Type": "application/json" })
  }

  deploy<Body>(form: FormData): Promise<Body> {
    return this.call<Body>("/deployments", form, {})
  }

  private async call<Body>(
    path: string,
    body: string | FormData,
    headers: Readonly<Record<string, string>>,
  ): Promise<Body> {
    const response = await fetch(`${this.url}${path}`, {
      method: "POST",
      body,
      headers: { ...headers, ...(await authorizationOf(this.credentials)) },
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`POST ${path}: HTTP ${response.status} ${text}`)
    }
    return JSON.parse(text) as Body
  }
}

function worldDiagram(process: string): string {
  return readFileSync(new URL(`../../../c8-core/world/${process}.bpmn`, import.meta.url), "utf8")
}

export async function until<Result>(
  what: string,
  read: () => Promise<Result | undefined>,
): Promise<Result> {
  const deadline = Date.now() + SETTLED_WITHIN_MS
  for (;;) {
    const result = await read()
    if (result !== undefined) {
      return result
    }
    if (Date.now() > deadline) {
      throw new Error(`the cluster did not show ${what} within ${SETTLED_WITHIN_MS} ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
}

export async function deployModel(calls: ClusterCalls, process: string): Promise<string> {
  const form = new FormData()
  const diagram = new Blob([worldDiagram(process)], { type: "application/xml" })
  form.append("resources", diagram, `${process}.bpmn`)
  const answer = await calls.deploy<{
    readonly deployments: readonly {
      readonly processDefinition: { readonly processDefinitionKey: string }
    }[]
  }>(form)
  const [deployed] = answer.deployments
  if (deployed === undefined) {
    throw new Error(`deploying ${process} created no process definition`)
  }
  return deployed.processDefinition.processDefinitionKey
}

function branded<Key extends string, Id>(
  ids: Readonly<Record<Key, string>>,
  brand: (id: string) => Id,
): Record<Key, Id> {
  const entries = Object.entries<string>(ids).map(([key, id]) => [key, brand(id)])
  return Object.fromEntries(entries) as Record<Key, Id>
}

export async function seedWorld(url: string, credentials: EngineCredentials): Promise<SeededWorld> {
  const diagrams = Object.fromEntries(
    WORLD_DEPLOYMENTS.map(({ process }) => [process, worldDiagram(process)]),
  )
  const world = await C8WorldSeed.seed(new ClusterCalls(url, credentials), {
    deployments: WORLD_DEPLOYMENTS,
    instances: WORLD_INSTANCES,
    localVariable: WORLD_LOCAL_VARIABLE,
    diagrams,
  })
  return {
    definitionIds: branded(world.definitionIds, DefinitionId),
    instanceIds: branded(world.instanceIds, InstanceId),
    unknown: {
      definitionId: DefinitionId(world.unknown.definitionId),
      instanceId: InstanceId(world.unknown.instanceId),
      incidentId: IncidentId(world.unknown.incidentId),
      bulkOperationId: BulkOperationId(world.unknown.bulkOperationId),
    },
  }
}
