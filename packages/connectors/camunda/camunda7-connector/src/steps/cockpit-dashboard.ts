import { buildCockpitDashboardData } from "../data/cockpit-data.js"
import { adapterStep } from "./shared.js"

export const loadCockpitDashboardStep = adapterStep({
  name: "load-cockpit-dashboard",
  description:
    "The process landscape: one row per definition key with running instances, failed jobs and incidents summed over all versions. Powers camunda7:process-health-kpi and camunda7:process-definitions-table.",
  dataType: "camunda7:cockpitDashboard",
  read: (_, { client, engineId }) => buildCockpitDashboardData(client, engineId),
  produces: { "camunda7:cockpitDashboardData": (data) => data },
})
