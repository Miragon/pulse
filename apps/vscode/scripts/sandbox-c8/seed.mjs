import { clusterVariables } from "../support/cluster-client.mjs"
import { waitUntil } from "../support/containers.mjs"
import { orderVariables, returnVariables } from "../sandbox/shop-data.mjs"
import { openUserTasks, walkJourneys } from "./journeys.mjs"

const SETTLED_MS = 120_000

function orderId(index) {
  return `ORD-${10_001 + index}`
}

const INSTANCE_DATA = {
  "order-fulfillment": {
    businessId: orderId,
    variables: (index, scenario) => ({
      ...orderVariables(index, scenario.variant),
      orderId: orderId(index),
    }),
  },
  "return-handling": {
    businessId: (index) => `RET-${5_001 + index}`,
    variables: (index) => returnVariables(index),
  },
}

async function deployAll(cluster, deployments) {
  const definitions = new Map()
  for (const [name, file] of deployments) {
    for (const definition of await cluster.deploy(name, file)) {
      const version = `${definition.processDefinitionId}:${definition.processDefinitionVersion}`
      definitions.set(version, definition.processDefinitionKey)
    }
  }
  return definitions
}

function startRequest(definitionKey, scenario, index) {
  const data = INSTANCE_DATA[scenario.process]
  return {
    processDefinitionKey: definitionKey,
    ...(scenario.withoutBusinessKey ? {} : { businessId: data.businessId(index) }),
    variables: { ...data.variables(index, scenario), ...scenario.variables },
  }
}

async function addLocalVariables(cluster, instanceKey, variables) {
  const [task] = await openUserTasks(cluster, instanceKey, "Activity_CheckOrder")
  await cluster.put(`/element-instances/${task.elementInstanceKey}/variables`, {
    variables,
    local: true,
  })
}

async function startInstance(cluster, definitionKey, scenario, index) {
  const request = startRequest(definitionKey, scenario, index)
  const { processInstanceKey } = await cluster.post("/process-instances", {
    ...request,
    variables: clusterVariables(request.variables),
  })
  if (scenario.localVariables !== undefined) {
    await addLocalVariables(cluster, processInstanceKey, scenario.localVariables)
  }
  if (scenario.cancel === true) {
    await cluster.post(`/process-instances/${processInstanceKey}/cancellation`, {})
  }
  return { key: processInstanceKey, variables: request.variables, scenario }
}

function plannedStarts(scenarios) {
  const nextIndex = new Map()
  return scenarios.flatMap((scenario) =>
    Array.from({ length: scenario.count }, () => {
      const index = nextIndex.get(scenario.process) ?? 0
      nextIndex.set(scenario.process, index + 1)
      return { scenario, index }
    }),
  )
}

export function businessIdsOf(scenarios) {
  return plannedStarts(scenarios).flatMap(({ scenario, index }) =>
    scenario.withoutBusinessKey ? [] : [INSTANCE_DATA[scenario.process].businessId(index)],
  )
}

async function startScenarios(cluster, definitions, scenarios) {
  const started = []
  for (const { scenario, index } of plannedStarts(scenarios)) {
    const definitionKey = definitions.get(`${scenario.process}:${scenario.version}`)
    if (definitionKey === undefined) {
      throw new Error(`${scenario.process} v${scenario.version} is not deployed.`)
    }
    started.push(await startInstance(cluster, definitionKey, scenario, index))
  }
  return started
}

const SHOP_PROCESSES = ["order-fulfillment", "shipment", "return-handling"]

export async function activeIncidentCount(cluster) {
  const counts = await Promise.all(
    SHOP_PROCESSES.map((processDefinitionId) =>
      cluster.count("/incidents/search", { state: "ACTIVE", processDefinitionId }),
    ),
  )
  return counts.reduce((sum, count) => sum + count, 0)
}

export async function holdsTheShop(cluster) {
  const shop = await cluster.count("/process-definitions/search", {
    processDefinitionId: "order-fulfillment",
  })
  return shop > 0
}

export async function seedCluster(cluster, { name, deployments, scenarios }) {
  const definitions = await deployAll(cluster, deployments)
  await walkJourneys(cluster, await startScenarios(cluster, definitions, scenarios))
  const expected = scenarios.reduce(
    (sum, scenario) => sum + scenario.count * (scenario.incidents ?? 0),
    0,
  )
  await waitUntil(
    async () => (await activeIncidentCount(cluster)) >= expected,
    `${expected} incidents on ${name}`,
    SETTLED_MS,
  )
  const actual = await activeIncidentCount(cluster)
  if (actual !== expected) {
    throw new Error(`${name} has ${actual} open incidents instead of ${expected}.`)
  }
}
