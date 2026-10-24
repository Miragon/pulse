import { Client, Variables, logger } from "camunda-external-task-client-js"

const CARRIER_LIMIT_KG = 31.5

const client = new Client({ baseUrl: "http://localhost:18090/engine-rest", use: logger })

async function bookCarrier({ task, taskService }) {
  const weightKg = task.variables.get("weightKg")
  if (weightKg > CARRIER_LIMIT_KG) {
    throw new Error(
      `Carrier rejected parcel for ${task.businessKey}: ${weightKg} kg exceeds the ${CARRIER_LIMIT_KG} kg limit`,
    )
  }
  const trackingNumber = `00340434${task.id.slice(0, 10)}`
  await taskService.complete(task, new Variables().set("trackingNumber", trackingNumber))
}

client.subscribe("book-carrier", bookCarrier)
