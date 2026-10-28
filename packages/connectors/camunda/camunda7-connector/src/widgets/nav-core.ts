import { truncate } from "@miragon/pulse-widget-shell/widgets"
import { translator } from "../messages/index.js"
import type { ViewParams } from "./cockpit-app/views.js"
import type { NavIntent } from "./navigation.js"

/** Client-side view state shared by the cockpit app and the standalone shell; pure, host policy stays with the host. */
export type CockpitView =
  | { section: "overview" }
  | { section: "process-list" }
  | { section: "incidents" }
  | { section: "settings" }
  | {
      section: "cluster-detail"
      activityId: string
      incidentType: string
      messageSignature?: string
      label?: string
    }
  | {
      section: "process-detail"
      processDefinitionKey: string
      focus?: "incidents"
      label?: string
    }
  | { section: "process-instances"; processDefinitionKey?: string }
  | { section: "instance-detail"; processInstanceId: string; label?: string }
  | { section: "incident-detail"; incidentId: string; label?: string }

function labelOf(intent: { label?: string }): { label?: string } {
  return intent.label ? { label: intent.label } : {}
}

// Exhaustive via `satisfies never`: a new intent fails to compile instead of no-oping.
export function intentToView(intent: NavIntent): CockpitView {
  switch (intent.type) {
    case "overview":
      return { section: "overview" }
    // A drill view, not the overview: the emitting KPIs sit on the overview, so that was a no-op click.
    case "process-list":
      return { section: "process-list" }
    case "incidents":
      return { section: "incidents" }
    case "settings":
      return { section: "settings" }
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
    default:
      return view.section
  }
}

// An existing entry pops back (adopting the new params). The cockpit's top-section reset stays in its
// sidebar: the standalone shell must always keep a way back to its origin.
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

// Never empties the stack; leaving the trail entirely (shell back-to-origin) is the host's job.
export function popTo(stack: CockpitView[], to?: number): CockpitView[] {
  const index = Math.min(to ?? stack.length - 2, stack.length - 1)
  return stack.slice(0, Math.max(index, 0) + 1)
}

export function crumbLabel(view: CockpitView, locale: string): string {
  const tr = (key: string, params?: Record<string, unknown>) => translator(locale, key, params)
  switch (view.section) {
    case "overview":
      return tr("cockpit.crumb.overview")
    case "process-list":
      return tr("cockpit.crumb.processList")
    case "incidents":
      return tr("cockpit.crumb.incidents")
    case "settings":
      return tr("cockpit.section.settings")
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
  }
}

export function buildViewParams(view: CockpitView, engine: string): ViewParams {
  return {
    engine,
    processDefinitionKey: "processDefinitionKey" in view ? view.processDefinitionKey : undefined,
    processInstanceId: "processInstanceId" in view ? view.processInstanceId : undefined,
    incidentId: "incidentId" in view ? view.incidentId : undefined,
    activityId: "activityId" in view ? view.activityId : undefined,
    incidentType: "incidentType" in view ? view.incidentType : undefined,
    messageSignature: "messageSignature" in view ? view.messageSignature : undefined,
    focus: "focus" in view ? view.focus : undefined,
  }
}

// The shell's conversational fallback names the view on top; a stored "last intent" goes stale on a breadcrumb pop.
export function viewToIntent(view: CockpitView): NavIntent {
  switch (view.section) {
    case "process-detail":
      return view.focus === "incidents"
        ? {
            type: "process-incidents",
            processDefinitionKey: view.processDefinitionKey,
            ...labelOf(view),
          }
        : {
            type: "process-detail",
            processDefinitionKey: view.processDefinitionKey,
            ...labelOf(view),
          }
    case "process-instances":
      return { type: "process-instances", processDefinitionKey: view.processDefinitionKey }
    case "instance-detail":
      return {
        type: "instance-detail",
        processInstanceId: view.processInstanceId,
        ...labelOf(view),
      }
    case "incident-detail":
      return { type: "incident-detail", incidentId: view.incidentId, ...labelOf(view) }
    case "cluster-detail":
      return {
        type: "cluster-detail",
        activityId: view.activityId,
        incidentType: view.incidentType,
        messageSignature: view.messageSignature,
        ...labelOf(view),
      }
    default:
      return { type: view.section }
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
