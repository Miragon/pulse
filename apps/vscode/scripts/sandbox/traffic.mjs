import { engineDate, typedVariables } from '../support/engine-client.mjs';
import { orderVariables } from './shop-data.mjs';
import { runWorkers } from './workers.mjs';

const TICK_MS = 2000;
const TASK_AGE_MS = 10_000;
const FIRST_LIVE_ORDER = 90_001;
const LIVE_KEYS = encodeURIComponent('ORD-9%');
const LIVE_ORDERS = [
  { variant: 'regular' },
  { variant: 'regular' },
  { variant: 'expiredCard' },
  { variant: 'regular' },
  { variant: 'regular', rejected: true },
  { variant: 'overweight' },
  { variant: 'regular' },
  { variant: 'longNotes' },
  { variant: 'legacyCustomer' },
  { variant: 'regular' },
  { variant: 'regular', rejected: true },
  { variant: 'paypalTimeout' },
];

function log(message) {
  console.log(`${new Date().toLocaleTimeString()}  ${message}`);
}

function planOf(businessKey) {
  const number = Number(businessKey.slice('ORD-'.length)) - FIRST_LIVE_ORDER;
  return LIVE_ORDERS[number % LIVE_ORDERS.length];
}

async function startOrder(engine, number) {
  const businessKey = `ORD-${FIRST_LIVE_ORDER + number}`;
  const { variant } = planOf(businessKey);
  const variables = {
    ...orderVariables(FIRST_LIVE_ORDER + number, variant),
    orderedAt: new Date(),
  };
  await engine.post('/process-definition/key/order-fulfillment/start', {
    businessKey,
    variables: typedVariables(variables),
  });
  log(`${businessKey} received (${variant})`);
}

async function oldestLiveTask(engine, taskDefinitionKey) {
  const createdBefore = encodeURIComponent(engineDate(new Date(Date.now() - TASK_AGE_MS)));
  const [task] = await engine.get(
    `/task?taskDefinitionKey=${taskDefinitionKey}&processInstanceBusinessKeyLike=${LIVE_KEYS}&createdBefore=${createdBefore}&sortBy=created&sortOrder=asc&maxResults=1`,
  );
  if (task === undefined) {
    return undefined;
  }
  const instance = await engine.get(`/process-instance/${task.processInstanceId}`);
  return { id: task.id, businessKey: instance.businessKey };
}

async function reviewOldestOrder(engine) {
  const task = await oldestLiveTask(engine, 'Activity_CheckOrder');
  if (task === undefined) {
    return;
  }
  const approved = planOf(task.businessKey).rejected !== true;
  await engine.post(`/task/${task.id}/complete`, { variables: typedVariables({ approved }) });
  log(`${task.businessKey} ${approved ? 'approved' : 'rejected'} by sales`);
}

async function packOldestParcel(engine) {
  const task = await oldestLiveTask(engine, 'Activity_PackParcel');
  if (task === undefined) {
    return;
  }
  await engine.post(`/task/${task.id}/complete`, {});
  log(`${task.businessKey} parcel packed`);
}

async function confirmOldestPayment(engine) {
  const [instance] = await engine.get(
    `/process-instance?businessKeyLike=${LIVE_KEYS}&activityIdIn=Activity_AwaitPayment&maxResults=1`,
  );
  if (instance === undefined) {
    return;
  }
  await engine.post('/message', {
    messageName: 'PaymentConfirmed',
    processInstanceId: instance.id,
  });
  log(`${instance.businessKey} payment confirmed`);
}

function reportWork(task, outcome) {
  const prefix = `${task.businessKey ?? task.processInstanceId} ${task.topicName}:`;
  log(
    outcome.kind === 'complete'
      ? `${prefix} ${outcome.summary}`
      : `${prefix} FAILED ${outcome.summary}`,
  );
}

async function liveOrdersSoFar(engine) {
  const { count } = await engine.get(
    `/history/process-instance/count?processDefinitionKey=order-fulfillment&processInstanceBusinessKeyLike=${LIVE_KEYS}`,
  );
  return count;
}

async function tick(engine, number, firstOrder) {
  if (number % 3 === 0) {
    await startOrder(engine, firstOrder + number / 3);
  }
  await reviewOldestOrder(engine);
  await runWorkers(engine, reportWork);
  if (number % 2 === 1) {
    await confirmOldestPayment(engine);
  }
  await packOldestParcel(engine);
}

export async function runTraffic(engine) {
  log(`Live traffic on ${engine.endpoint}. Stop with Ctrl+C.`);
  const firstOrder = await liveOrdersSoFar(engine);
  for (let number = 0; ; number++) {
    await tick(engine, number, firstOrder);
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }
}
