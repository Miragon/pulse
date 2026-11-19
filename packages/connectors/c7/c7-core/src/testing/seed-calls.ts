/** The requests of the Camunda 7 world's seed, each sent through the engine it is handed. */

import type {
  C7SeedEngine,
  C7SeedRequest,
  C7WorldDeployment,
  C7WorldInstance,
  C7WorldValue,
} from "./c7-world.js"

const INCIDENT_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 1_000
const BOUNDARY = "pulse-c7-world"

interface DeploymentAnswer {
  readonly deployedProcessDefinitions?: Readonly<Record<string, { readonly id: string }>>
}

interface IncidentAnswer {
  readonly id: string
  readonly rootCauseIncidentId?: string
}

function jsonRequest(method: string, body: unknown): C7SeedRequest {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
}

async function sent(engine: C7SeedEngine, path: string, request?: C7SeedRequest) {
  const url = `${engine.url}${path}`
  const answer = await engine.send(url, request)
  if (!answer.ok) {
    throw new Error(
      `${request?.method ?? "GET"} ${url}: HTTP ${answer.status} ${await answer.text()}`,
    )
  }
  return answer
}

async function engineCall<Body>(
  engine: C7SeedEngine,
  path: string,
  request?: C7SeedRequest,
): Promise<Body> {
  return (await (await sent(engine, path, request)).json()) as Body
}

/** The multipart body of a deployment of one diagram, as `FormData` would send it. */
function deploymentRequest(deployment: C7WorldDeployment, diagram: string): C7SeedRequest {
  const body = [
    `--${BOUNDARY}`,
    'Content-Disposition: form-data; name="deployment-name"',
    "",
    `pulse-world-${deployment.alias}`,
    `--${BOUNDARY}`,
    `Content-Disposition: form-data; name="model"; filename="${deployment.process}.bpmn"`,
    "Content-Type: text/xml",
    "",
    diagram,
    `--${BOUNDARY}--`,
    "",
  ].join("\r\n")
  return {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${BOUNDARY}` },
    body,
  }
}

/** Deploys `diagram` as `deployment` and answers the id of the process definition it created. */
export async function deploy(
  engine: C7SeedEngine,
  deployment: C7WorldDeployment,
  diagram: string,
): Promise<string> {
  const created = await engineCall<DeploymentAnswer>(
    engine,
    "/deployment/create",
    deploymentRequest(deployment, diagram),
  )
  const [definition] = Object.values(created.deployedProcessDefinitions ?? {})
  if (definition === undefined) {
    throw new Error(`deploying ${deployment.alias} created no process definition`)
  }
  return definition.id
}

function typedValue(value: C7WorldValue) {
  if (value === null) {
    return { value, type: "Null" }
  }
  if (typeof value === "object") {
    return { value: value.date.replace("Z", "+0000"), type: "Date" }
  }
  return { value, type: typeof value === "number" ? "Integer" : "String" }
}

function typedVariables(variables: C7WorldInstance["variables"]) {
  return Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [name, typedValue(value)]),
  )
}

/** Starts `instance` on the definition `definitionId` and answers the instance's id. */
export async function start(
  engine: C7SeedEngine,
  instance: C7WorldInstance,
  definitionId: string,
): Promise<string> {
  const started = await engineCall<{ readonly id: string }>(
    engine,
    `/process-definition/${encodeURIComponent(definitionId)}/start`,
    jsonRequest("POST", {
      businessKey: instance.businessKey,
      variables: typedVariables(instance.variables),
    }),
  )
  return started.id
}

async function rootIncidentCount(engine: C7SeedEngine): Promise<number> {
  const incidents = await engineCall<IncidentAnswer[]>(engine, "/incident")
  return incidents.filter((incident) => incident.id === incident.rootCauseIncidentId).length
}

/**
 * Polls the open incidents until `expected` of them are root incidents, waiting a second between
 * two polls; fails once the waits passed two minutes.
 */
export async function waitForIncidents(engine: C7SeedEngine, expected: number): Promise<void> {
  let waited = 0
  while ((await rootIncidentCount(engine)) < expected) {
    if (waited > INCIDENT_TIMEOUT_MS) {
      throw new Error(`the world has no ${expected} incidents after ${INCIDENT_TIMEOUT_MS} ms`)
    }
    await engine.wait(POLL_INTERVAL_MS)
    waited += POLL_INTERVAL_MS
  }
}

/** Sets a local String variable on the task instance `instanceId` waits at; its answer unread. */
export async function addLocalVariable(
  engine: C7SeedEngine,
  instanceId: string,
  variable: { readonly instance: string; readonly name: string; readonly value: string },
): Promise<void> {
  const [task] = await engineCall<{ readonly id: string }[]>(
    engine,
    `/task?processInstanceId=${instanceId}`,
  )
  if (task === undefined) {
    throw new Error(`${variable.instance} waits at no task`)
  }
  await engine.send(
    `${engine.url}/task/${task.id}/localVariables/${variable.name}`,
    jsonRequest("PUT", { value: variable.value, type: "String" }),
  )
}

/** Starts a second token of instance `instanceId` before the element `elementId`. */
export async function addSecondToken(
  engine: C7SeedEngine,
  instanceId: string,
  elementId: string,
): Promise<void> {
  await sent(
    engine,
    `/process-instance/${instanceId}/modification`,
    jsonRequest("POST", {
      instructions: [{ type: "startBeforeActivity", activityId: elementId }],
    }),
  )
}
