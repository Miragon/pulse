import type { AnalyticsDashboardData } from "@miragon/pulse-analytics-client"
import type { Named } from "../../bpmn-names.js"

/** The dashboard payload the widgets read: the figures plus the process names behind their keys. */
export type DashboardView = Named<AnalyticsDashboardData>
