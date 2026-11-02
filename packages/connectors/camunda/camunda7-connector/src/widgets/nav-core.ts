import { truncate } from "@miragon/pulse-ui"
import { translator } from "../messages/use-t.js"
import type { CockpitView } from "../view-models.js"
import type { NavIntent } from "./navigation.js"

function labelOf(intent: { label?: string }): { label?: string } {
  return intent.label ? { label: intent.label } : {}
}

// Exhaustive via `satisfies never`: a new intent fails to compile instead of no-oping.
export function intentToView(intent: NavIntent): CockpitView {
  switch (intent.type) {
    case "overview":
      return { section: "overview" }
    case "incidents":
      return { section: "incidents" }
    case "cluster-detail":
      return {
        section: "cluster-detail",
        activityId: intent.activityId,
        incidentType: intent.incidentType,
        messageSignature: intent.messageSignature,
        ...labelOf(intent),
      }
    case "process-detail":
      return {
        section: "process-detail",
        processDefinitionKey: intent.processDefinitionKey,
        ...labelOf(intent),
      }
    case "process-instances":
      return { section: "process-instances", processDefinitionKey: intent.processDefinitionKey }
    // Kept public contract (widgets emit it): same definition view, focused on incidents.
    case "process-incidents":
      return {
        section: "process-detail",
        processDefinitionKey: intent.processDefinitionKey,
        focus: "incidents",
        ...labelOf(intent),
      }
    case "instance-detail":
      return {
        section: "instance-detail",
        processInstanceId: intent.processInstanceId,
        ...labelOf(intent),
      }
    case "incident-detail":
      return { section: "incident-detail", incidentId: intent.incidentId, ...labelOf(intent) }
    case "jobs":
      return {
        section: "jobs",
        processDefinitionKey: intent.processDefinitionKey,
        failedOnly: intent.failedOnly,
      }
  }
  return intent satisfies never
}

// Ignores `focus` on purpose: detail -> incidents-focus on one definition updates the entry instead of stacking a twin.
export function viewKey(view: CockpitView): string {
  switch (view.section) {
    case "cluster-detail":
      return `cluster-detail:${view.activityId}:${view.incidentType}:${view.messageSignature ?? ""}`
    case "process-detail":
    case "process-instances":
      return `${view.section}:${view.processDefinitionKey ?? "*"}`
    case "instance-detail":
      return `instance-detail:${view.processInstanceId}`
    case "incident-detail":
      return `incident-detail:${view.incidentId}`
    case "jobs":
      return `jobs:${view.processDefinitionKey ?? "*"}:${view.failedOnly ? "failed" : "all"}`
    case "history":
      return `history:${view.processInstanceId}`
    default:
      return view.section
  }
}

// An existing entry pops back (adopting the new params). The top-section reset is the cockpit
// reducer's policy, not this one's.
export function pushView(stack: CockpitView[], view: CockpitView): CockpitView[] {
  const key = viewKey(view)
  const existing = stack.findIndex((v) => viewKey(v) === key)
  if (existing >= 0) {
    const next = stack.slice(0, existing + 1)
    next[existing] = view
    return next
  }
  return [...stack, view]
}

// Never empties the stack; leaving the engine (the "all engines" crumb) is the cockpit's job.
export function popTo(stack: CockpitView[], to?: number): CockpitView[] {
  const index = Math.min(to ?? stack.length - 2, stack.length - 1)
  return stack.slice(0, Math.max(index, 0) + 1)
}

export function crumbLabel(view: CockpitView, locale: string): string {
  const tr = (key: string, params?: Record<string, unknown>) => translator(locale, key, params)
  switch (view.section) {
    case "overview":
      return tr("cockpit.crumb.overview")
    case "incidents":
      return tr("cockpit.crumb.incidents")
    // Names before ids (#322 U13): the drill's label, else the addressing id.
    case "process-detail":
      return view.label ?? view.processDefinitionKey
    case "process-instances":
      return tr("cockpit.crumb.instances")
    case "instance-detail":
      return view.label ?? tr("cockpit.crumb.instance", { id: truncate(view.processInstanceId, 8) })
    case "incident-detail":
      return view.label
        ? tr("cockpit.crumb.incidentAt", { activity: view.label })
        : tr("cockpit.crumb.incident", { id: truncate(view.incidentId, 8) })
    case "cluster-detail":
      return view.label ?? tr("cockpit.crumb.cluster", { activity: view.activityId })
    case "jobs":
      return tr("cockpit.crumb.jobs")
    case "history":
      return tr("cockpit.crumb.history", { id: truncate(view.processInstanceId, 8) })
  }
}

export interface SelectedEntity {
  incidentId?: string
  processInstanceId?: string
  processDefinitionKey?: string
}

// Silent (chat-free) navigation must never leave the model blind to "this incident/process".
export function selectedEntity(view: CockpitView): SelectedEntity {
  if ("incidentId" in view) return { incidentId: view.incidentId }
  if ("processInstanceId" in view) return { processInstanceId: view.processInstanceId }
  if ("processDefinitionKey" in view && view.processDefinitionKey) {
    return { processDefinitionKey: view.processDefinitionKey }
  }
  return {}
}

// `landing` is the chooser when several engines are listed and none resolved.
export type CockpitScope =
  { kind: "landing" } | { kind: "fleet" } | { kind: "engine"; engineId: string }
