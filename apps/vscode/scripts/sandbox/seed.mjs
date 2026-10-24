import { waitUntil } from "../support/containers.mjs"
import { typedVariables } from "../support/engine-client.mjs"
import { orderVariables, returnVariables } from "./shop-data.mjs"
import { walkJourneys } from "./journeys.mjs"

const INSTANCE_DATA = {
  "order-fulfillment": {
    businessKey: (index) => `ORD-${10_001 + index}`,
    variables: (index, scenario) => orderVariables(index, scenario.variant),
  },
  "return-handling": {
    businessKey: (index) => `RET-${5_001 + index}`,
    variables: (index) => returnVariables(index),
  },
}

async function deployAll(engine, deployments) {
  const definitions = new Map()
  for (const [name, file] of deployments) {
    for (const definition of await engine.deploy(name, [file])) {
      definitions.set(`${definition.key}:${definition.version}`, definition.id)
    }
  }
  return definitions
}

function startRequest(scenario, index) {
  const data = INSTANCE_DATA[scenario.process]
  const variables = { ...data.variables(index, scenario), ...scenario.variables }
  return {
    ...(scenario.withoutBusinessKey ? {} : { businessKey: data.businessKey(index) }),
    variables: typedVariables(variables),
  }
}

async function addLocalVariables(engine, instanceId, localVariables) {
  const [task] = await engine.get(`/task?processInstanceId=${instanceId}`)
  for (const [name, value] of Object.entries(typedVariables(localVariables))) {
    await engine.put(`/task/${task.id}/localVariables/${name}`, value)
  }
}

async function startInstance(engine, definitionId, scenario, index) {
  const instance = await engine.post(
    `/process-definition/${encodeURIComponent(definitionId)}/start`,
    startRequest(scenario, index),
  )
  if (scenario.localVariables !== undefined) {
    await addLocalVariables(engine, instance.id, scenario.localVariables)
  }
  if (scenario.cancel === true) {
    await engine.delete(`/process-instance/${instance.id}?skipCustomListeners=true`)
  }
  return { instanceId: instance.id, scenario }
}

async function startScenarios(engine, definitions, scenarios) {
  const started = []
  const nextIndex = new Map()
  for (const scenario of scenarios) {
    const definitionId = definitions.get(`${scenario.process}:${scenario.version}`)
    if (definitionId === undefined) {
      throw new Error(`${scenario.process} v${scenario.version} is not deployed.`)
    }
    for (let count = 0; count < scenario.count; count++) {
      const index = nextIndex.get(scenario.process) ?? 0
      nextIndex.set(scenario.process, index + 1)
      started.push(await startInstance(engine, definitionId, scenario, index))
    }
  }
  return started
}

export async function rootIncidentCount(engine) {
  const incidents = await engine.get("/incident")
  return incidents.filter((incident) => incident.id === incident.rootCauseIncidentId).length
}

export async function seedEngine(engine, { name, deployments, scenarios }) {
  const definitions = await deployAll(engine, deployments)
  await walkJourneys(engine, await startScenarios(engine, definitions, scenarios))
  const expected = scenarios.reduce(
    (sum, scenario) => sum + scenario.count * (scenario.incidents ?? 0),
    0,
  )
  await waitUntil(
    async () => (await rootIncidentCount(engine)) >= expected,
    `${expected} incidents on ${name}`,
    120_000,
  )
  const actual = await rootIncidentCount(engine)
  if (actual !== expected) {
    throw new Error(`${name} has ${actual} open root incidents instead of ${expected}.`)
  }
}
