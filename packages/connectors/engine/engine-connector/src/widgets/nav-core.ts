import { shortId } from "@miragon/pulse-ui"
import { translator } from "../messages/use-t.js"
import type { CockpitView, ListTenant } from "../view-models.js"
import type { NavIntent } from "./navigation.js"

function labelOf(intent: { label?: string }): { label?: string } {
  return intent.label ? { label: intent.label } : {}
}

/** A drill's process's tenant as a view names it: only where it names one. */
function tenantOf(intent: { tenantId?: string }): { tenantId?: string } {
  return intent.tenantId === undefined ? {} : { tenantId: intent.tenantId }
}

/** A drill's list narrowed to a tenant as a view names it: only where it narrows. */
function onlyTenantOf(intent: { onlyTenant?: ListTenant }): { onlyTenant?: ListTenant } {
  return intent.onlyTenant === undefined ? {} : { onlyTenant: intent.onlyTenant }
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
        ...tenantOf(intent),
        ...labelOf(intent),
      }
    case "process-instances":
      return {
        section: "process-instances",
        processDefinitionKey: intent.processDefinitionKey,
        ...onlyTenantOf(intent),
      }
    // Kept public contract (widgets emit it): same definition view, focused on incidents.
    case "process-incidents":
      return {
        section: "process-detail",
        processDefinitionKey: intent.processDefinitionKey,
        ...tenantOf(intent),
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
        ...onlyTenantOf(intent),
        failedOnly: intent.failedOnly,
      }
    // The view on the board's engine; the cockpit moves to that engine (its reducer).
    case "board-target":
      return intent.view
  }
  return intent satisfies never
}

/**
 * A view's tenant in its key (a process's, or the one its list is narrowed to): nothing where it
 * names none (a key's view keeps the key it had), none `@-`, else `@=<tenant>`; a key, an NCName,
 * holds no `@`.
 */
function tenantKey(tenantId: string | null | undefined): string {
  return tenantId === undefined ? "" : tenantId === null ? "@-" : `@=${tenantId}`
}

// Ignores `focus` on purpose: detail -> incidents-focus on one definition updates the entry instead of stacking a twin.
export function viewKey(view: CockpitView): string {
  switch (view.section) {
    case "cluster-detail":
      return `cluster-detail:${view.activityId}:${view.incidentType}:${view.messageSignature ?? ""}`
    case "process-detail":
      return `process-detail:${view.processDefinitionKey}${tenantKey(view.tenantId)}`
    case "process-instances":
      return `process-instances:${view.processDefinitionKey ?? "*"}${tenantKey(view.onlyTenant)}`
    case "instance-detail":
      return `instance-detail:${view.processInstanceId}`
    case "incident-detail":
      return `incident-detail:${view.incidentId}`
    case "jobs":
      return `jobs:${view.processDefinitionKey ?? "*"}${tenantKey(view.onlyTenant)}:${view.failedOnly ? "failed" : "all"}`
    case "history":
      return `history:${view.processInstanceId}`
    case "board":
      return `board:${view.board}`
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

type Tr = (key: string, params?: Record<string, unknown>) => string

/**
 * An instance by the drill's label (its business key, say); else by its short id, the kit's
 * `shortId`: a UUID (Camunda 7's) by its head, a number (a Camunda 8 key, whose head every key on
 * its partition shares) by its tail.
 */
function instanceCrumb(view: Extract<CockpitView, { section: "instance-detail" }>, tr: Tr) {
  return view.label ?? tr("cockpit.crumb.instance", { id: shortId(view.processInstanceId) })
}

/** A process by the drill's label, else its key; in a tenant, the tenant named beside it. */
function processCrumb(view: Extract<CockpitView, { section: "process-detail" }>, tr: Tr) {
  const process = view.label ?? view.processDefinitionKey
  return view.tenantId === undefined
    ? process
    : tr("cockpit.crumb.processInTenant", { process, tenant: view.tenantId })
}

/** An incident by the element it occurred at, the drill's label; else by its short id. */
function incidentCrumb(view: Extract<CockpitView, { section: "incident-detail" }>, tr: Tr) {
  return view.label
    ? tr("cockpit.crumb.incidentAt", { activity: view.label })
    : tr("cockpit.crumb.incident", { id: shortId(view.incidentId) })
}

export function crumbLabel(view: CockpitView, locale: string): string {
  const tr: Tr = (key, params) => translator(locale, key, params)
  switch (view.section) {
    case "overview":
      return tr("cockpit.crumb.overview")
    case "incidents":
      return tr("cockpit.crumb.incidents")
    // Names before ids (#322 U13): the drill's label, else the addressing id; and its tenant.
    case "process-detail":
      return processCrumb(view, tr)
    case "process-instances":
      return tr("cockpit.crumb.instances")
    case "instance-detail":
      return instanceCrumb(view, tr)
    case "incident-detail":
      return incidentCrumb(view, tr)
    case "cluster-detail":
      return view.label ?? tr("cockpit.crumb.cluster", { activity: view.activityId })
    case "jobs":
      return tr("cockpit.crumb.jobs")
    // The view's own title names the instance (N6): its crumb names the view, never the id twice.
    case "history":
      return tr("cockpit.crumb.history")
    // The board's title, once its data named it; else its id.
    case "board":
      return view.label ?? view.board
    // The chooser, as the crumb that leads there names it.
    case "landing":
      return tr("cockpit.crumb.allEngines")
  }
}

export interface SelectedEntity {
  incidentId?: string
  processInstanceId?: string
  processDefinitionKey?: string
  /** The process's tenant, where the view names one. */
  tenantId?: string
  /** The tenant a list of the key is narrowed to (null: the runs in none), where it is. */
  onlyTenant?: ListTenant
}

/** What a view of a key names beside it: a process's tenant, or a list's narrowing to one. */
function tenantsOf(view: CockpitView): Pick<SelectedEntity, "tenantId" | "onlyTenant"> {
  if ("tenantId" in view && view.tenantId !== undefined) return { tenantId: view.tenantId }
  if ("onlyTenant" in view && view.onlyTenant !== undefined) return { onlyTenant: view.onlyTenant }
  return {}
}

// Silent (chat-free) navigation must never leave the model blind to "this incident/process".
export function selectedEntity(view: CockpitView): SelectedEntity {
  if ("incidentId" in view) return { incidentId: view.incidentId }
  if ("processInstanceId" in view) return { processInstanceId: view.processInstanceId }
  if ("processDefinitionKey" in view && view.processDefinitionKey) {
    return { processDefinitionKey: view.processDefinitionKey, ...tenantsOf(view) }
  }
  return {}
}

/** A board's view: the app-level route that reads the engines its board names. */
export type BoardView = Extract<CockpitView, { section: "board" }>

// `landing` is the chooser: several engines are listed and none resolved, or the landing route
// opened it; `board` a board, which reads the engines it names, so no engine of the cockpit is open.
export type CockpitScope =
  | { kind: "landing" }
  | { kind: "fleet" }
  | { kind: "board"; view: BoardView }
  | { kind: "engine"; engineId: string }
