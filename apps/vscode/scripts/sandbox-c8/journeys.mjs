import { waitUntil } from "../support/containers.mjs"
import { runWorkersUntilIdle } from "./workers.mjs"

const SETTLED_MS = 60_000
const AWAIT_PARCEL = "Gateway_AwaitParcel"

async function soon(what, find) {
  let found
  await waitUntil(
    async () => {
      found = await find()
      return found !== undefined
    },
    what,
    SETTLED_MS,
  )
  return found
}

export function openUserTasks(cluster, instanceKey, elementId, count = 1) {
  return soon(`${count} ${elementId} of ${instanceKey}`, async () => {
    const tasks = await cluster.search("/user-tasks/search", {
      processInstanceKey: instanceKey,
      elementId,
      state: "CREATED",
    })
    return tasks.length >= count ? tasks : undefined
  })
}

async function completeUserTasks(cluster, instanceKey, elementId, count = 1) {
  for (const task of await openUserTasks(cluster, instanceKey, elementId, count)) {
    await cluster.post(`/user-tasks/${task.userTaskKey}/completion`, {})
  }
}

async function completeJob(cluster, instanceKey, type) {
  const [job] = await soon(`a ${type} job of ${instanceKey}`, async () => {
    const jobs = await cluster.search("/jobs/search", {
      processInstanceKey: instanceKey,
      type,
      state: "CREATED",
    })
    return jobs.length > 0 ? jobs : undefined
  })
  await cluster.post(`/jobs/${job.jobKey}/completion`, {})
}

function correlate(cluster, name, correlationKey) {
  return soon(`${name} for ${correlationKey}`, () =>
    cluster.post("/messages/correlation", { name, correlationKey }).catch(() => undefined),
  )
}

function waitingForParcel(cluster, filter) {
  return cluster.count("/element-instances/search", {
    ...filter,
    elementId: AWAIT_PARCEL,
    state: "ACTIVE",
  })
}

async function announceRecall(cluster, instance) {
  await soon(`${instance.key} to wait for its parcel`, async () =>
    (await waitingForParcel(cluster, { processInstanceKey: instance.key })) > 0 ? true : undefined,
  )
  const waiting = await waitingForParcel(cluster, {})
  if (waiting > 1) {
    throw new Error(
      `The recall would reach ${waiting} returns: start the recalled return before every other return that waits for its parcel.`,
    )
  }
  await cluster.post("/signals/broadcast", { signalName: "ProductRecall" })
}

async function shipmentOf(cluster, instance) {
  const [shipment] = await soon(`the shipment of ${instance.key}`, async () => {
    const found = await cluster.search("/process-instances/search", {
      parentProcessInstanceKey: instance.key,
    })
    return found.length > 0 ? found : undefined
  })
  return shipment.processInstanceKey
}

const STEPS = {
  check: (cluster, instance) => completeUserTasks(cluster, instance.key, "Activity_CheckOrder"),
  label: (cluster, instance) => completeJob(cluster, instance.key, "create-return-label"),
  recall: announceRecall,
  pay: (cluster, instance) => correlate(cluster, "PaymentConfirmed", instance.variables.orderId),
  receive: (cluster, instance) =>
    correlate(cluster, "ReturnParcelReceived", instance.variables.orderReference),
  inspect: (cluster, instance) =>
    completeUserTasks(cluster, instance.key, "Activity_InspectParcel"),
  pack: async (cluster, instance) =>
    completeUserTasks(
      cluster,
      await shipmentOf(cluster, instance),
      "Activity_PackParcel",
      instance.variables.parcelCount,
    ),
}

const PHASES = [
  ["check", "label", "recall"],
  ["pay", "receive"],
  ["pack", "inspect"],
]

export async function walkJourneys(cluster, started) {
  for (const phase of PHASES) {
    await runWorkersUntilIdle(cluster)
    for (const instance of started) {
      for (const step of phase.filter((name) => instance.scenario.through?.includes(name))) {
        await STEPS[step](cluster, instance)
      }
    }
  }
  await runWorkersUntilIdle(cluster)
}
