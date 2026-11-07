import { clusterVariables } from "../support/cluster-client.mjs"
import { orderVariables } from "../sandbox/shop-data.mjs"
import { runWorkers } from "./workers.mjs"

const TICK_MS = 2000
const REVIEW_AFTER_MS = 10_000
const GIVE_UP_AFTER_MS = 120_000
const FIRST_LIVE_ORDER = 90_001
const LIVE_ORDERS = [
  { variant: "regular" },
  { variant: "regular" },
  { variant: "expiredCard" },
  { variant: "regular" },
  { variant: "regular", rejected: true },
  { variant: "overweight" },
  { variant: "regular" },
  { variant: "longNotes" },
  { variant: "legacyCustomer" },
  { variant: "regular" },
  { variant: "regular", rejected: true },
  { variant: "paypalTimeout" },
]

function log(message) {
  console.log(`${new Date().toLocaleTimeString()}  ${message}`)
}

function ageOf(order) {
  return Date.now() - order.since
}

function advance(order, stage) {
  order.stage = stage
  order.since = Date.now()
}

async function startOrder(cluster, live, number) {
  const businessId = `ORD-${FIRST_LIVE_ORDER + number}`
  const plan = LIVE_ORDERS[number % LIVE_ORDERS.length]
  const variables = {
    ...orderVariables(FIRST_LIVE_ORDER + number, plan.variant),
    orderedAt: new Date(),
    orderId: businessId,
  }
  const { processInstanceKey } = await cluster.post("/process-instances", {
    processDefinitionId: "order-fulfillment",
    businessId,
    variables: clusterVariables(variables),
  })
  live.push({ key: processInstanceKey, businessId, plan, stage: "received", since: Date.now() })
  log(`${businessId} received (${plan.variant})`)
}

async function openTask(cluster, processInstanceKey, elementId) {
  const [task] = await cluster.search("/user-tasks/search", {
    processInstanceKey,
    elementId,
    state: "CREATED",
  })
  return task
}

async function reviewOldestOrder(cluster, live) {
  const order = live.find((each) => each.stage === "received" && ageOf(each) >= REVIEW_AFTER_MS)
  const task = order && (await openTask(cluster, order.key, "Activity_CheckOrder"))
  if (task === undefined) {
    return
  }
  const approved = order.plan.rejected !== true
  await cluster.post(`/user-tasks/${task.userTaskKey}/completion`, { variables: { approved } })
  advance(order, approved ? "approved" : "done")
  log(`${order.businessId} ${approved ? "approved" : "rejected"} by sales`)
}

function awaitsPayment(cluster, order) {
  return cluster.count("/element-instances/search", {
    processInstanceKey: order.key,
    elementId: "Activity_AwaitPayment",
    state: "ACTIVE",
  })
}

async function confirmOldestPayment(cluster, live) {
  for (const order of live.filter((each) => each.stage === "approved")) {
    if ((await awaitsPayment(cluster, order)) > 0) {
      await cluster.post("/messages/correlation", {
        name: "PaymentConfirmed",
        correlationKey: order.businessId,
      })
      advance(order, "paid")
      log(`${order.businessId} payment confirmed`)
      return
    }
    if (ageOf(order) > GIVE_UP_AFTER_MS) {
      advance(order, "done")
    }
  }
}

async function packTaskOf(cluster, order) {
  const [shipment] = await cluster.search("/process-instances/search", {
    parentProcessInstanceKey: order.key,
  })
  return shipment && openTask(cluster, shipment.processInstanceKey, "Activity_PackParcel")
}

async function packOldestParcel(cluster, live) {
  for (const order of live.filter((each) => each.stage === "paid")) {
    const task = await packTaskOf(cluster, order)
    if (task !== undefined) {
      await cluster.post(`/user-tasks/${task.userTaskKey}/completion`, {})
      log(`${order.businessId} parcel packed`)
      return
    }
    if (ageOf(order) > GIVE_UP_AFTER_MS) {
      advance(order, "done")
    }
  }
}

function reportWork(job, outcome) {
  const prefix = `${job.variables.orderId ?? job.processInstanceKey} ${job.type}:`
  log(
    outcome.kind === "complete"
      ? `${prefix} ${outcome.summary}`
      : `${prefix} FAILED ${outcome.summary}`,
  )
}

function liveOrdersSoFar(cluster) {
  return cluster.count("/process-instances/search", {
    processDefinitionId: "order-fulfillment",
    businessId: { $like: "ORD-9*" },
  })
}

async function tick(cluster, live, number, firstOrder) {
  if (number % 3 === 0) {
    await startOrder(cluster, live, firstOrder + number / 3)
  }
  await reviewOldestOrder(cluster, live)
  await runWorkers(cluster, reportWork)
  if (number % 2 === 1) {
    await confirmOldestPayment(cluster, live)
  }
  await packOldestParcel(cluster, live)
}

export async function runTraffic(cluster) {
  log(`Live traffic on ${cluster.endpoint}. Stop with Ctrl+C.`)
  const firstOrder = await liveOrdersSoFar(cluster)
  const live = []
  for (let number = 0; ; number++) {
    await tick(cluster, live, number, firstOrder)
    live.splice(0, live.length, ...live.filter((order) => order.stage !== "done"))
    await new Promise((resolve) => setTimeout(resolve, TICK_MS))
  }
}
