import { removeContainer, startContainer, waitUntil } from './support/containers.mjs';
import { engineClient, typedVariables } from './support/engine-client.mjs';

const CONTAINER = 'pulse-dev-engine';
const IMAGE = process.env.PULSE_ENGINE_IMAGE ?? 'operaton/operaton:2.1.5';
const PORT = process.env.PULSE_ENGINE_PORT ?? '18080';
const engine = engineClient(`http://localhost:${PORT}/engine-rest`);
const WORLD = 'packages/adapter-c7/test/world';

const ORDERS = [
  ['ORD-1001', 1, 'review'],
  ['ORD-1002', 1, 'charge'],
  ['ORD-1003', 1, 'express'],
  ['ORD-2001', 2, 'review'],
  ['ORD-2002', 2, 'review'],
  ['ORD-2003', 2, 'review'],
  ['ORD-2004', 2, 'charge'],
  ['ORD-2005', 2, 'charge'],
  ['ORD-2006', 2, 'review'],
  ['ORD-2007', 2, 'express'],
  ['ORD-2008', 2, 'review'],
  ['ORD-2009', 2, 'charge'],
  ['ORD-2010', 2, 'review'],
];
const DISPATCHES = ['DSP-3001', 'DSP-3002'];
const EXPECTED_INCIDENTS = 6;

async function deploy(process) {
  const [definition] = await engine.deploy(`pulse-demo-${process}`, [`${WORLD}/${process}.bpmn`]);
  return definition.id;
}

async function start(definitionId, businessKey, variables) {
  await engine.post(`/process-definition/${encodeURIComponent(definitionId)}/start`, {
    businessKey,
    variables: typedVariables(variables),
  });
}

async function seed() {
  await deploy('label');
  const orderVersions = { 1: await deploy('order'), 2: await deploy('order') };
  const dispatch = await deploy('dispatch');
  for (const [businessKey, version, route] of ORDERS) {
    await start(orderVersions[version], businessKey, { route, amount: 42, customer: 'C-77' });
  }
  for (const businessKey of DISPATCHES) {
    await start(dispatch, businessKey, { orderId: 'ORD-1001' });
  }
  await waitUntil(
    async () =>
      (await engine.get('/incident')).filter(
        (incident) => incident.id === incident.rootCauseIncidentId,
      ).length >= EXPECTED_INCIDENTS,
    `${EXPECTED_INCIDENTS} incidents`,
    120_000,
  );
}

async function up() {
  startContainer({ name: CONTAINER, image: IMAGE, port: PORT });
  await waitUntil(engine.isReady, 'the engine to start', 180_000);
  await seed();
  console.log(`Engine ready at ${engine.endpoint} (${IMAGE}), seeded with demo instances.`);
}

const command = process.argv[2];
if (command === 'up') {
  await up();
} else if (command === 'down') {
  removeContainer(CONTAINER);
} else {
  console.error('Usage: node scripts/engine.mjs up|down');
  process.exit(1);
}
