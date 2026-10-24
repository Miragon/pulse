import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  BulkOperationId,
  DefinitionId,
  IncidentId,
  InstanceId,
} from '../../../../src/contract/index.js';
import {
  WORLD_BULK_INSTANCES,
  WORLD_COMMAND_INSTANCES,
  WORLD_DEPLOYMENTS,
  WORLD_INSTANCES,
  WORLD_LOCAL_VARIABLE,
  WORLD_MIGRATION_INSTANCES,
  WORLD_SECOND_TOKEN,
  type CommandInstanceAlias,
  type CommandWorld,
  type DeploymentAlias,
  type InstanceAlias,
  type MigrationSet,
  type SeededWorld,
  type WorldDeployment,
  type WorldInstance,
} from '../../../../src/contract/conformance/index.js';

const DEPLOYMENT_ORDER: readonly DeploymentAlias[] = [
  'label@1',
  'order@1',
  'order@2',
  'dispatch@1',
];
const EXPECTED_ROOT_INCIDENTS = 2;
const INCIDENT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;

interface DeploymentResponse {
  readonly deployedProcessDefinitions?: Readonly<Record<string, { readonly id: string }>>;
}

interface IncidentResponse {
  readonly id: string;
  readonly rootCauseIncidentId?: string;
}

async function engineCall<Body>(url: string, init?: RequestInit): Promise<Body> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${url}: HTTP ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as Body;
}

function modelFile(deployment: WorldDeployment): string {
  return fileURLToPath(new URL(`../world/${deployment.process}.bpmn`, import.meta.url));
}

async function deploy(engineUrl: string, deployment: WorldDeployment): Promise<DefinitionId> {
  const form = new FormData();
  form.append('deployment-name', `pulse-world-${deployment.alias}`);
  const xml = await readFile(modelFile(deployment), 'utf8');
  form.append('model', new Blob([xml], { type: 'text/xml' }), `${deployment.process}.bpmn`);
  const created = await engineCall<DeploymentResponse>(`${engineUrl}/deployment/create`, {
    method: 'POST',
    body: form,
  });
  const [definition] = Object.values(created.deployedProcessDefinitions ?? {});
  if (definition === undefined) {
    throw new Error(`deploying ${deployment.alias} created no process definition`);
  }
  return DefinitionId(definition.id);
}

function deploymentOf(alias: DeploymentAlias): WorldDeployment {
  const deployment = WORLD_DEPLOYMENTS.find((candidate) => candidate.alias === alias);
  if (deployment === undefined) {
    throw new Error(`the world has no deployment ${alias}`);
  }
  return deployment;
}

async function deployWorld(engineUrl: string): Promise<Record<DeploymentAlias, DefinitionId>> {
  const definitionIds: Partial<Record<DeploymentAlias, DefinitionId>> = {};
  for (const alias of DEPLOYMENT_ORDER) {
    definitionIds[alias] = await deploy(engineUrl, deploymentOf(alias));
  }
  return definitionIds as Record<DeploymentAlias, DefinitionId>;
}

function typedVariables(variables: WorldInstance['variables']) {
  return Object.fromEntries(
    Object.entries(variables).map(([name, value]) => [
      name,
      { value, type: typeof value === 'number' ? 'Integer' : 'String' },
    ]),
  );
}

async function start(
  engineUrl: string,
  instance: WorldInstance<string>,
  definitionId: DefinitionId,
): Promise<InstanceId> {
  const started = await engineCall<{ readonly id: string }>(
    `${engineUrl}/process-definition/${encodeURIComponent(definitionId)}/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        businessKey: instance.businessKey,
        variables: typedVariables(instance.variables),
      }),
    },
  );
  return InstanceId(started.id);
}

async function startWorld(
  engineUrl: string,
  definitionIds: Readonly<Record<DeploymentAlias, DefinitionId>>,
): Promise<Record<InstanceAlias, InstanceId>> {
  const instanceIds: Partial<Record<InstanceAlias, InstanceId>> = {};
  for (const instance of WORLD_INSTANCES) {
    instanceIds[instance.businessKey] = await start(
      engineUrl,
      instance,
      definitionIds[instance.deployment],
    );
  }
  return instanceIds as Record<InstanceAlias, InstanceId>;
}

async function rootIncidentCount(engineUrl: string): Promise<number> {
  const incidents = await engineCall<IncidentResponse[]>(`${engineUrl}/incident`);
  return incidents.filter((incident) => incident.id === incident.rootCauseIncidentId).length;
}

async function waitForIncidents(engineUrl: string, expected: number): Promise<void> {
  const deadline = Date.now() + INCIDENT_TIMEOUT_MS;
  while ((await rootIncidentCount(engineUrl)) < expected) {
    if (Date.now() > deadline) {
      throw new Error(`the world has no ${expected} incidents after ${INCIDENT_TIMEOUT_MS} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function addLocalVariable(
  engineUrl: string,
  instanceIds: Readonly<Record<InstanceAlias, InstanceId>>,
): Promise<void> {
  const instanceId = instanceIds[WORLD_LOCAL_VARIABLE.instance];
  const [task] = await engineCall<{ readonly id: string }[]>(
    `${engineUrl}/task?processInstanceId=${instanceId}`,
  );
  if (task === undefined) {
    throw new Error(`${WORLD_LOCAL_VARIABLE.instance} waits at no task`);
  }
  await fetch(`${engineUrl}/task/${task.id}/localVariables/${WORLD_LOCAL_VARIABLE.name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: WORLD_LOCAL_VARIABLE.value, type: 'String' }),
  });
}

async function addSecondToken(engineUrl: string, instanceId: InstanceId): Promise<void> {
  const url = `${engineUrl}/process-instance/${instanceId}/modification`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instructions: [{ type: 'startBeforeActivity', activityId: WORLD_SECOND_TOKEN.elementId }],
    }),
  });
  if (!response.ok) {
    throw new Error(`POST ${url}: HTTP ${response.status} ${await response.text()}`);
  }
}

function unknownIds() {
  return {
    definitionId: DefinitionId(`pulse-unknown:1:${randomUUID()}`),
    instanceId: InstanceId(randomUUID()),
    incidentId: IncidentId(randomUUID()),
    bulkOperationId: BulkOperationId(randomUUID()),
  };
}

async function startAll(
  engineUrl: string,
  instances: readonly WorldInstance<string>[],
  world: SeededWorld,
): Promise<InstanceId[]> {
  return Promise.all(
    instances.map((instance) =>
      start(engineUrl, instance, world.definitionIds[instance.deployment]),
    ),
  );
}

export async function seedWorld(engineUrl: string): Promise<SeededWorld> {
  const definitionIds = await deployWorld(engineUrl);
  const instanceIds = await startWorld(engineUrl, definitionIds);
  await addLocalVariable(engineUrl, instanceIds);
  await waitForIncidents(engineUrl, EXPECTED_ROOT_INCIDENTS);
  return { definitionIds, instanceIds, unknown: unknownIds() };
}

export async function seedCommandWorld(
  engineUrl: string,
  world: SeededWorld,
): Promise<CommandWorld> {
  const instanceIds: Partial<Record<CommandInstanceAlias, InstanceId>> = {};
  for (const instance of WORLD_COMMAND_INSTANCES) {
    instanceIds[instance.businessKey] = await start(
      engineUrl,
      instance,
      world.definitionIds[instance.deployment],
    );
  }
  await addSecondToken(engineUrl, instanceIds[WORLD_SECOND_TOKEN.instance]!);
  const migrationInstanceIds = await startMigrationSets(engineUrl, world);
  const failing = [...WORLD_COMMAND_INSTANCES, ...Object.values(WORLD_MIGRATION_INSTANCES).flat()];
  await waitForIncidents(
    engineUrl,
    EXPECTED_ROOT_INCIDENTS +
      failing.filter(({ variables }) => variables.route === 'charge').length,
  );
  return {
    instanceIds: instanceIds as Record<CommandInstanceAlias, InstanceId>,
    bulkInstanceIds: {
      cancel: await startAll(engineUrl, WORLD_BULK_INSTANCES.cancel, world),
      stop: await startAll(engineUrl, WORLD_BULK_INSTANCES.stop, world),
    },
    migrationInstanceIds,
    definitionIds: world.definitionIds,
    unknown: unknownIds(),
  };
}

async function startMigrationSets(
  engineUrl: string,
  world: SeededWorld,
): Promise<Record<MigrationSet, InstanceId[]>> {
  return {
    whole: await startAll(engineUrl, WORLD_MIGRATION_INSTANCES.whole, world),
    partial: await startAll(engineUrl, WORLD_MIGRATION_INSTANCES.partial, world),
    skip: await startAll(engineUrl, WORLD_MIGRATION_INSTANCES.skip, world),
    stay: await startAll(engineUrl, WORLD_MIGRATION_INSTANCES.stay, world),
  };
}
