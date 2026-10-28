import { buildJobPanelData } from "../data/cockpit-data.js"
import { adapterStep } from "./shared.js"

export const loadJobsStep = adapterStep({
  name: "load-jobs",
  description:
    "The engine's jobs (first page) with exact totals of all and of failed jobs (no retries left). Powers camunda7:job-panel.",
  dataType: "camunda7:jobPanel",
  // The show tool's defaults: every job, the first page.
  read: (_, { client, engineId }) => buildJobPanelData(client, engineId, { failedOnly: false }),
  produces: { "camunda7:jobPanelData": (data) => data },
})
