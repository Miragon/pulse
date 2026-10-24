import { typedVariables } from '../support/engine-client.mjs';
import { cardExpiredTrace, nodeErrorTrace, paypalTimeoutTrace } from './stack-traces.mjs';

const WORKER_ID = 'pulse-sandbox-worker';
const LOCK_MS = 60_000;
const RETRY_AFTER_MS = 15 * 60_000;
const DEFAULT_RETRIES = 3;
const PAYPAL_LIMIT = 1000;
const CARRIER_LIMIT_KG = 31.5;
const FETCHED_VARIABLES = ['paymentMethod', 'cardLast4', 'cardExpiry', 'amount', 'weightKg'];

function completed(variables, summary) {
  return { kind: 'complete', variables, summary };
}

function failed(errorMessage, errorDetails, retries) {
  return { kind: 'fail', errorMessage, errorDetails, retries, summary: errorMessage };
}

function isExpired(cardExpiry) {
  const [month, year] = cardExpiry.split('/').map(Number);
  const now = new Date();
  return year * 12 + month < now.getFullYear() * 12 + now.getMonth() + 1;
}

function reference(task) {
  return task.businessKey ?? task.processInstanceId.slice(0, 8);
}

function chargePayment(order, task) {
  if (order.paymentMethod === 'card' && isExpired(order.cardExpiry)) {
    const message = `Card ending ${order.cardLast4} expired on ${order.cardExpiry}`;
    return failed(message, cardExpiredTrace(reference(task), message), 0);
  }
  if (order.paymentMethod === 'paypal' && order.amount > PAYPAL_LIMIT) {
    const message = 'PayPal did not answer within 30000 ms';
    return failed(message, paypalTimeoutTrace(message), (task.retries ?? DEFAULT_RETRIES) - 1);
  }
  return completed({ paymentId: `PAY-${task.id.slice(0, 8)}` }, 'payment charged');
}

function bookCarrier(order, task) {
  if (order.weightKg > CARRIER_LIMIT_KG) {
    const message = `Carrier rejected parcel for ${reference(task)}: ${order.weightKg} kg exceeds the ${CARRIER_LIMIT_KG} kg limit`;
    return failed(message, nodeErrorTrace(message), 0);
  }
  return completed({ trackingNumber: `00340434${task.id.slice(0, 10)}` }, 'carrier booked');
}

export const HANDLERS = {
  'reserve-stock': (_order, task) =>
    completed({ stockReservation: `RES-${task.id.slice(0, 8)}` }, 'stock reserved'),
  'charge-payment': chargePayment,
  'book-carrier': bookCarrier,
};

function plainValues(variables) {
  return Object.fromEntries(Object.entries(variables).map(([name, { value }]) => [name, value]));
}

async function settle(engine, task, outcome) {
  if (outcome.kind === 'complete') {
    await engine.post(`/external-task/${task.id}/complete`, {
      workerId: WORKER_ID,
      variables: typedVariables(outcome.variables),
    });
    return;
  }
  await engine.post(`/external-task/${task.id}/failure`, {
    workerId: WORKER_ID,
    errorMessage: outcome.errorMessage,
    errorDetails: outcome.errorDetails,
    retries: Math.max(outcome.retries, 0),
    retryTimeout: outcome.retries > 0 ? RETRY_AFTER_MS : 0,
  });
}

export async function runWorkers(engine, report = () => undefined) {
  const tasks = await engine.post('/external-task/fetchAndLock', {
    workerId: WORKER_ID,
    maxTasks: 100,
    topics: Object.keys(HANDLERS).map((topicName) => ({
      topicName,
      lockDuration: LOCK_MS,
      variables: FETCHED_VARIABLES,
    })),
  });
  for (const task of tasks) {
    const outcome = HANDLERS[task.topicName](plainValues(task.variables), task);
    await settle(engine, task, outcome);
    report(task, outcome);
  }
  return tasks.length;
}

export async function runWorkersUntilIdle(engine, report) {
  while ((await runWorkers(engine, report)) > 0) {
    continue;
  }
}
