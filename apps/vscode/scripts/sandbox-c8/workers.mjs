import { cardExpiredText, carrierRejectedText, paypalTimeoutText } from "./error-texts.mjs"

const WORKER = "pulse-sandbox-worker"
const LOCK_MS = 60_000
const RETRY_AFTER_MS = 15 * 60_000
const IDLE_ROUNDS = 3
const IDLE_PAUSE_MS = 500
const PAYPAL_LIMIT = 1000
const CARRIER_LIMIT_KG = 31.5
const FETCHED_VARIABLES = [
  "orderId",
  "paymentMethod",
  "cardLast4",
  "cardExpiry",
  "amount",
  "weightKg",
]

function completed(variables, summary) {
  return { kind: "complete", variables, summary }
}

function failed(errorMessage, retries, summary) {
  return { kind: "fail", errorMessage, retries, summary }
}

function isExpired(cardExpiry) {
  const [month, year] = cardExpiry.split("/").map(Number)
  const now = new Date()
  return year * 12 + month < now.getFullYear() * 12 + now.getMonth() + 1
}

function chargePayment(order, job) {
  if (order.paymentMethod === "card" && isExpired(order.cardExpiry)) {
    const message = `Card ending ${order.cardLast4} expired on ${order.cardExpiry}`
    return failed(cardExpiredText(order.orderId, message), 0, message)
  }
  if (order.paymentMethod === "paypal" && order.amount > PAYPAL_LIMIT) {
    const message = "PayPal did not answer within 30000 ms"
    return failed(paypalTimeoutText(message), job.retries - 1, message)
  }
  return completed({ paymentId: `PAY-${job.jobKey.slice(-8)}` }, "payment charged")
}

function bookCarrier(order) {
  if (order.weightKg > CARRIER_LIMIT_KG) {
    const message = `Carrier rejected parcel for ${order.orderId}: ${order.weightKg} kg exceeds the ${CARRIER_LIMIT_KG} kg limit`
    return failed(carrierRejectedText(message), 0, message)
  }
  return completed({ trackingNumber: `00340434${order.orderId.slice(4)}` }, "carrier booked")
}

const HANDLERS = {
  "reserve-stock": (_order, job) =>
    completed({ stockReservation: `RES-${job.jobKey.slice(-8)}` }, "stock reserved"),
  "charge-payment": chargePayment,
  "book-carrier": bookCarrier,
}

async function settle(cluster, job, outcome) {
  if (outcome.kind === "complete") {
    await cluster.post(`/jobs/${job.jobKey}/completion`, { variables: outcome.variables })
    return
  }
  await cluster.post(`/jobs/${job.jobKey}/failure`, {
    retries: Math.max(outcome.retries, 0),
    errorMessage: outcome.errorMessage,
    retryBackOff: outcome.retries > 0 ? RETRY_AFTER_MS : 0,
  })
}

async function activate(cluster, type) {
  const { jobs } = await cluster.post("/jobs/activation", {
    type,
    worker: WORKER,
    timeout: LOCK_MS,
    maxJobsToActivate: 100,
    fetchVariable: FETCHED_VARIABLES,
    requestTimeout: -1,
  })
  return jobs
}

export async function runWorkers(cluster, report = () => undefined) {
  let worked = 0
  for (const [type, handle] of Object.entries(HANDLERS)) {
    for (const job of await activate(cluster, type)) {
      const outcome = handle(job.variables, job)
      await settle(cluster, job, outcome)
      report(job, outcome)
      worked++
    }
  }
  return worked
}

export async function runWorkersUntilIdle(cluster) {
  for (let idle = 0; idle < IDLE_ROUNDS;) {
    if ((await runWorkers(cluster)) > 0) {
      idle = 0
      continue
    }
    idle++
    await new Promise((resolve) => setTimeout(resolve, IDLE_PAUSE_MS))
  }
}
