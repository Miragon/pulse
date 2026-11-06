import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import {
  BulkOperationId,
  DefinitionId,
  IncidentId,
  InstanceId,
  type EngineCredentials,
} from "../../../../src/contract/index.js"
import {
  WORLD_DEPLOYMENTS,
  WORLD_INSTANCES,
  WORLD_LOCAL_VARIABLE,
  type DeploymentAlias,
  type InstanceAlias,
  type SeededWorld,
  type WorldDeployment,
  type WorldValue,
} from "../../../../src/contract/conformance/index.js"
import { authorizationOf } from "./engine-container.js"

const DEPLOYMENT_ORDER: readonly DeploymentAlias[] = ["label@1", "order@1", "order@2", "dispatch@1"]
const SETTLED_WITHIN_MS = 120_000
const POLL_INTERVAL_MS = 250
const FAILING_JOB_TYPES = ["charge-payment", "render-label"]
const WORKER_ERROR = [
  "java.lang.IllegalStateException: the worker failed",
  "\tat io.miragon.shop.Worker.handle(Worker.java:42)",
  "Caused by: java.net.ConnectException: the card gateway is unreachable",
  "\tat io.miragon.shop.Gateway.connect(Gateway.java:7)",
].join("\n")
const EXPECTED_STATISTICS: Readonly<Record<string, readonly [number, number]>> = {
  "pulse-order": [2, 1],
  "pulse-dispatch": [0, 1],
  "pulse-label": [0, 1],
}

interface Items<Item> {
  readonly items: readonly Item[]
}

export class ClusterCalls {
  constructor(
    private readonly url: string,
    private readonly credentials: EngineCredentials,
  ) {}

  post<Body>(path: string, body: unknown): Promise<Body> {
    return this.call<Body>("POST", path, JSON.stringify(body), {
      "Content-Type": "application/json",
    })
  }

  put(path: string, body: unknown): Promise<unknown> {
    return this.call("PUT", path, JSON.stringify(body), { "Content-Type": "application/json" })
  }

  deploy<Body>(form: FormData): Promise<Body> {
    return this.call<Body>("POST", "/deployments", form, {})
  }

  private async call<Body>(
    method: string,
    path: string,
    body: string | FormData,
    headers: Readonly<Record<string, string>>,
  ): Promise<Body> {
    const response = await fetch(`${this.url}${path}`, {
      method,
      body,
      headers: { ...headers, ...(await authorizationOf(this.credentials)) },
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`${method} ${path}: HTTP ${response.status} ${text}`)
    }
    return (text === "" ? undefined : JSON.parse(text)) as Body
  }
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

function modelOf(process: string): Promise<string> {
  return readFile(fileURLToPath(new URL(`../world/${process}.bpmn`, import.meta.url)), "utf8")
}

export async function deployModel(
  calls: ClusterCalls,
  process: string,
  marker = "",
): Promise<string> {
  const xml = `${await modelOf(process)}${marker === "" ? "" : `\n<!-- ${marker} -->\n`}`
  const form = new FormData()
  form.append("resources", new Blob([xml], { type: "application/xml" }), `${process}.bpmn`)
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

function deploymentOf(alias: DeploymentAlias): WorldDeployment {
  const deployment = WORLD_DEPLOYMENTS.find((candidate) => candidate.alias === alias)
  if (deployment === undefined) {
    throw new Error(`the world has no deployment ${alias}`)
  }
  return deployment
}

async function deployWorld(calls: ClusterCalls): Promise<Record<DeploymentAlias, DefinitionId>> {
  const definitionIds: Partial<Record<DeploymentAlias, DefinitionId>> = {}
  for (const alias of DEPLOYMENT_ORDER) {
    const { process, version } = deploymentOf(alias)
    definitionIds[alias] = DefinitionId(await deployModel(calls, process, version > 1 ? alias : ""))
  }
  return definitionIds as Record<DeploymentAlias, DefinitionId>
}

function plainValue(value: WorldValue): string | number | null {
  return typeof value === "object" && value !== null ? value.date : value
}

async function startWorld(
  calls: ClusterCalls,
  definitionIds: Readonly<Record<DeploymentAlias, DefinitionId>>,
): Promise<Record<InstanceAlias, InstanceId>> {
  const instanceIds: Partial<Record<InstanceAlias, InstanceId>> = {}
  for (const instance of WORLD_INSTANCES) {
    const started = await calls.post<{ readonly processInstanceKey: string }>(
      "/process-instances",
      {
        processDefinitionKey: definitionIds[instance.deployment],
        businessId: instance.businessKey,
        variables: Object.fromEntries(
          Object.entries(instance.variables).map(([name, value]) => [name, plainValue(value)]),
        ),
      },
    )
    instanceIds[instance.businessKey] = InstanceId(started.processInstanceKey)
  }
  return instanceIds as Record<InstanceAlias, InstanceId>
}

async function failJobsOf(calls: ClusterCalls, type: string): Promise<void> {
  const jobs = await until(`a job of ${type}`, async () => {
    const answer = await calls.post<{ readonly jobs: readonly { readonly jobKey: string }[] }>(
      "/jobs/activation",
      { type, worker: "pulse-seed", timeout: 60_000, maxJobsToActivate: 10 },
    )
    return answer.jobs.length > 0 ? answer.jobs : undefined
  })
  for (const job of jobs) {
    await calls.post(`/jobs/${job.jobKey}/failure`, { retries: 0, errorMessage: WORKER_ERROR })
  }
}

async function addLocalVariable(
  calls: ClusterCalls,
  instanceIds: Readonly<Record<InstanceAlias, InstanceId>>,
): Promise<void> {
  const element = await until("the element of the local variable", async () => {
    const answer = await calls.post<Items<{ readonly elementInstanceKey: string }>>(
      "/element-instances/search",
      {
        filter: {
          processInstanceKey: instanceIds[WORLD_LOCAL_VARIABLE.instance],
          elementId: WORLD_LOCAL_VARIABLE.elementId,
        },
      },
    )
    return answer.items[0]
  })
  await calls.put(`/element-instances/${element.elementInstanceKey}/variables`, {
    variables: { [WORLD_LOCAL_VARIABLE.name]: WORLD_LOCAL_VARIABLE.value },
    local: true,
  })
}

async function untilExported(
  calls: ClusterCalls,
  instanceIds: Readonly<Record<InstanceAlias, InstanceId>>,
): Promise<void> {
  await until("the world in its secondary storage", async () => {
    const [statistics, incidents, local] = await Promise.all([
      calls.post<
        Items<{
          readonly processDefinitionId: string
          readonly activeInstancesWithoutIncidentCount: number
          readonly activeInstancesWithIncidentCount: number
        }>
      >("/process-definitions/statistics/process-instances", {}),
      calls.post<Items<unknown>>("/incidents/search", { filter: { state: "ACTIVE" } }),
      calls.post<Items<unknown>>("/variables/search", {
        filter: {
          processInstanceKey: instanceIds[WORLD_LOCAL_VARIABLE.instance],
          name: WORLD_LOCAL_VARIABLE.name,
        },
      }),
    ])
    const countsFit = Object.entries(EXPECTED_STATISTICS).every(([process, [without, withIt]]) => {
      const row = statistics.items.find((item) => item.processDefinitionId === process)
      return (
        row?.activeInstancesWithoutIncidentCount === without &&
        row.activeInstancesWithIncidentCount === withIt
      )
    })
    return countsFit && incidents.items.length === 2 && local.items.length === 1 ? true : undefined
  })
}

export async function seedWorld(url: string, credentials: EngineCredentials): Promise<SeededWorld> {
  const calls = new ClusterCalls(url, credentials)
  const definitionIds = await deployWorld(calls)
  const instanceIds = await startWorld(calls, definitionIds)
  for (const type of FAILING_JOB_TYPES) {
    await failJobsOf(calls, type)
  }
  await addLocalVariable(calls, instanceIds)
  await untilExported(calls, instanceIds)
  return {
    definitionIds,
    instanceIds,
    unknown: {
      definitionId: DefinitionId("9007199254740991"),
      instanceId: InstanceId("9007199254740990"),
      incidentId: IncidentId("9007199254740989"),
      bulkOperationId: BulkOperationId("9007199254740988"),
    },
  }
}
