import { waitUntil } from "../support/containers.mjs"
import { runWorkersUntilIdle } from "./workers.mjs"

const JOURNEY_WORKER = "pulse-sandbox-journey"

async function completeUserTasks(engine, instanceId, taskDefinitionKey) {
  const tasks = await engine.get(
    `/task?processInstanceId=${instanceId}&taskDefinitionKey=${taskDefinitionKey}`,
  )
  for (const task of tasks) {
    await engine.post(`/task/${task.id}/complete`, {})
  }
}

async function completeWorkerTask(engine, instanceId, topicName) {
  const tasks = await engine.get(
    `/external-task?processInstanceId=${instanceId}&topicName=${topicName}`,
  )
  for (const task of tasks) {
    await engine.post(`/external-task/${task.id}/lock`, {
      workerId: JOURNEY_WORKER,
      lockDuration: 60_000,
    })
    await engine.post(`/external-task/${task.id}/complete`, { workerId: JOURNEY_WORKER })
  }
}

async function fireTimer(engine, instanceId, activityId) {
  const jobs = await engine.get(`/job?processInstanceId=${instanceId}&activityId=${activityId}`)
  for (const job of jobs) {
    await engine.post(`/job/${job.id}/execute`)
  }
}

async function calledInstance(engine, instanceId) {
  const [called] = await engine.get(`/process-instance?superProcessInstance=${instanceId}`)
  return called.id
}

async function inShipment(engine, instanceId, act) {
  await act(await calledInstance(engine, instanceId))
}

const STEPS = {
  check: (engine, id) => completeUserTasks(engine, id, "Activity_CheckOrder"),
  label: (engine, id) => completeWorkerTask(engine, id, "create-return-label"),
  pay: (engine, id) =>
    engine.post("/message", { messageName: "PaymentConfirmed", processInstanceId: id }),
  overdue: (engine, id) => fireTimer(engine, id, "Event_PaymentOverdue"),
  receive: (engine, id) =>
    engine.post("/message", { messageName: "ReturnParcelReceived", processInstanceId: id }),
  recall: async (engine, id) => {
    const [execution] = await engine.get(
      `/execution?processInstanceId=${id}&signalEventSubscriptionName=ProductRecall`,
    )
    await engine.post("/signal", { name: "ProductRecall", executionId: execution.id })
  },
  inspect: (engine, id) => completeUserTasks(engine, id, "Activity_InspectParcel"),
  pack: (engine, id) =>
    inShipment(engine, id, (called) => completeUserTasks(engine, called, "Activity_PackParcel")),
  pickup: (engine, id) =>
    inShipment(engine, id, (called) => fireTimer(engine, called, "Event_AwaitPickup")),
}

const PHASES = [
  ["check", "label"],
  ["pay", "overdue", "receive", "recall"],
  ["pack", "inspect"],
  ["pickup"],
]

async function settle(engine) {
  await runWorkersUntilIdle(engine)
  await waitUntil(
    async () => (await engine.get("/job/count?executable=true")).count === 0,
    "the job executor to finish",
    120_000,
  )
  await runWorkersUntilIdle(engine)
}

export async function walkJourneys(engine, started) {
  for (const phase of PHASES) {
    await settle(engine)
    for (const { instanceId, scenario } of started) {
      for (const step of phase.filter((name) => scenario.through?.includes(name))) {
        await STEPS[step](engine, instanceId)
      }
    }
  }
  await settle(engine)
}
