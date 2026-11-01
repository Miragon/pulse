import type { FailureDashboardData } from "@miragon/pulse-analytics-client"
import type { Named } from "../../bpmn-names.js"

/** The failure payload the widgets read: the figures plus the process names behind their keys. */
export type FailureView = Named<FailureDashboardData>
