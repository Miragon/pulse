/**
 * The read composites on @miragon/pulse-engine-core, the workflow domain pulse-cli runs too: one
 * call answers what took several reads (`camunda7_inspect_process_instance`,
 * `camunda7_engine_status`). Each takes the input of its schema (`inspectProcessInstanceInput`,
 * `engineStatusInput` in the client) and the client `withEngine` resolved, and returns plain data
 * for the model: no next steps (they would name tools a toolset may lack), the engine by its id,
 * variables cut like every read, and the lists engine-core leaves uncapped for the CLI (wait
 * states, incidents, timeline, variables, definitions, topics) capped here, each cut named in
 * `truncated`. The caps bound the result, not the reads: engine-core still loads the whole lists.
 */

import type { Client } from "@miragon/pulse-camunda7-client"
import type {
  engineStatusInput,
  inspectProcessInstanceInput,
} from "@miragon/pulse-camunda7-client/schemas"
import {
  type EnginePort,
  type Finding,
  type IncidentView,
  type InstanceView,
  inspectInstance,
  readStatus,
  type Selection,
  type TimelineEntry,
} from "@miragon/pulse-engine-core"
import type { z } from "zod"
import { boundFailureText, condenseStacktrace } from "../tools/incident-issue.js"
import { enginePortFor } from "./engine-port.js"
import { truncatePlainVariables } from "./variable-truncation.js"
import { asToolError } from "./workflow-errors.js"

export type InspectArgs = z.infer<typeof inspectProcessInstanceInput>
export type EngineStatusArgs = z.infer<typeof engineStatusInput>

/**
 * What each finding code of engine-core's triage says, under its severity; STATUS_RULE is built
 * from it, and `composites-status.wire.test.ts` holds its codes and severities to the findings
 * engine-core raises.
 */
export const FINDING_RULES: Readonly<
  Record<string, { readonly severity: "critical" | "warning"; readonly says: string }>
> = {
  JOBS_OVERDUE: {
    severity: "critical",
    says: "executable jobs overdue (is the job executor running?)",
  },
  INCIDENTS: { severity: "warning", says: "incident groups" },
  NO_WORKER: { severity: "warning", says: "topics without a worker" },
  LOCK_EXPIRED: { severity: "warning", says: "topics with expired locks" },
  BATCH_FAILURES: { severity: "warning", says: "failed batch jobs" },
  UNKNOWN_KEY: { severity: "warning", says: "keys not deployed" },
}

function saying(severity: "critical" | "warning"): string {
  return Object.values(FINDING_RULES)
    .filter((rule) => rule.severity === severity)
    .map((rule) => rule.says)
    .join(", ")
}

/**
 * How the status verdict comes about and what its counts mean; the cockpit's view has a verdict
 * of its own (open incident counts against CAMUNDA_HEALTH_*), so the two may differ for one engine.
 */
export const STATUS_RULE =
  `critical: ${saying("critical")}; warning: ${saying("warning")}; else ok. ` +
  "Independent of the cockpit's incident-count verdict. incidentsTotal counts every open " +
  "incident, propagated the copies on calling instances; the incident groups and definitions " +
  "count root causes."

/** Timeline entries and variables the model gets at most (the newest entries, the first names). */
export const MAX_TIMELINE_ENTRIES = 100
export const MAX_VARIABLES = 100
/** Wait states the model gets at most, in engine-core's order (by tree depth, instance, activity). */
export const MAX_WAIT_STATES = 100
/** Root-cause incidents the model gets at most: the oldest, the ones engine-core loads causes for. */
export const MAX_INCIDENTS = 10
/** Definitions, external-task topics and incident groups of the status. */
export const MAX_STATUS_ROWS = 10

/** An entry without its next step (it would name a tool the toolset may lack). */
function withoutNext<T extends { next: unknown }>(entry: T): Omit<T, "next"> {
  const data: Partial<T> = { ...entry }
  delete data.next
  return data as Omit<T, "next">
}

/**
 * `port` that keeps the whole text of every stacktrace and error-details read by its id (the job
 * or external task); engine-core hands on only the first 200 lines, which can end before the
 * Caused-by chain.
 */
function recordingTexts(port: EnginePort, texts: Map<string, string>): EnginePort {
  return {
    ...port,
    async text(operationId, pathArgs) {
      const text = await port.text(operationId, pathArgs)
      const [id] = pathArgs
      if (text !== undefined && id !== undefined) texts.set(id, text)
      return text
    },
  }
}

/** An incident as the model gets it: the stacktrace one condensed string, as get_job_stacktrace's. */
type ModelIncident = Omit<IncidentView, "stacktrace"> & { readonly stacktrace?: string }

/** The stacktrace in the condensed, bounded form every other tool gives, from the whole text. */
function condensed(incident: IncidentView, texts: ReadonlyMap<string, string>): ModelIncident {
  const { stacktrace, ...data } = incident
  if (stacktrace === undefined) return data
  const id = incident.jobId ?? incident.externalTaskId
  const raw = (id === undefined ? undefined : texts.get(id)) ?? stacktrace.join("\n")
  return { ...data, stacktrace: boundFailureText(condenseStacktrace(raw)) }
}

/** The first `max` rows of a list; a cut is named in `notes`. */
function firstRows<T>(rows: readonly T[], max: number, label: string, notes: string[]) {
  if (rows.length <= max) return rows
  notes.push(`${label}: ${max} of ${rows.length} shown`)
  return rows.slice(0, max)
}

/** The first `MAX_VARIABLES` variables, each cut like every other variable read. */
function cappedVariables(variables: Readonly<Record<string, unknown>>, notes: string[]) {
  const entries = Object.entries(variables)
  if (entries.length > MAX_VARIABLES) {
    notes.push(`variables: ${MAX_VARIABLES} of ${entries.length} shown`)
  }
  return truncatePlainVariables(Object.fromEntries(entries.slice(0, MAX_VARIABLES)))
}

/** The newest `MAX_TIMELINE_ENTRIES` entries; engine-core orders the timeline oldest first. */
function cappedTimeline(timeline: readonly TimelineEntry[], notes: string[]) {
  if (timeline.length <= MAX_TIMELINE_ENTRIES) return timeline
  notes.push(`timeline: the newest ${MAX_TIMELINE_ENTRIES} of ${timeline.length} entries shown`)
  return timeline.slice(-MAX_TIMELINE_ENTRIES)
}

const RUNNING: ReadonlySet<string> = new Set(["ACTIVE", "SUSPENDED"])

/**
 * The view for the model: data, no next steps, condensed stacktraces, every list cut.
 * engine-core's `truncated: true` (the called-instance tree was cut) becomes a note among the
 * others, so `truncated` reads like the status's: what was cut, and of how many. An ended
 * instance has no `children`: engine-core reads called instances from the running tree only, so
 * an empty list would claim it called none (its timeline names them).
 */
type ModelInstanceView = Omit<
  InstanceView,
  "next" | "truncated" | "variables" | "incidents" | "children"
> & {
  readonly incidents: readonly ModelIncident[]
  readonly children?: InstanceView["children"]
  readonly variables?: Readonly<Record<string, unknown>>
  /** What was cut, and of how many. */
  readonly truncated?: readonly string[]
}

function modelInstanceView(
  view: InstanceView,
  texts: ReadonlyMap<string, string>,
): ModelInstanceView {
  const { truncated, variables, timeline, children, waitingAt, incidents, ...data } =
    withoutNext(view)
  const notes: string[] = []
  const shown = {
    ...data,
    waitingAt: firstRows(waitingAt, MAX_WAIT_STATES, "waitingAt", notes),
    incidents: firstRows(incidents, MAX_INCIDENTS, "incidents", notes).map((incident) =>
      condensed(incident, texts),
    ),
    ...(RUNNING.has(view.state) ? { children } : {}),
    ...(variables === undefined ? {} : { variables: cappedVariables(variables, notes) }),
    ...(timeline === undefined ? {} : { timeline: cappedTimeline(timeline, notes) }),
  }
  if (truncated) notes.push("children: the called-instance tree was cut")
  return notes.length > 0 ? { ...shown, truncated: notes } : shown
}

function selectionOf(args: InspectArgs): Selection {
  return {
    ...(args.processInstanceId === undefined ? {} : { id: args.processInstanceId }),
    ...(args.businessKey === undefined ? {} : { businessKey: args.businessKey }),
    ...(args.processDefinitionKey === undefined
      ? {}
      : { processDefinitionKey: args.processDefinitionKey }),
    latest: args.latest === true,
  }
}

/** Where one process instance waits and why; a selection error is a tool error (`[CODE] …`). */
export async function inspectForModel(
  client: Client,
  args: InspectArgs,
  engineId: string,
): Promise<ModelInstanceView> {
  const texts = new Map<string, string>()
  const view = await inspectInstance(
    recordingTexts(enginePortFor(client), texts),
    selectionOf(args),
    {
      variables: args.includeVariables === true,
      history: args.includeHistory === true,
      stacktrace: args.includeStacktraces === true,
    },
  ).catch((error: unknown) => {
    throw asToolError(error, engineId)
  })
  return modelInstanceView(view, texts)
}

/** The topics a finding names (no worker, expired locks). */
function namedTopics(findings: readonly Finding[]): ReadonlySet<string> {
  return new Set(findings.flatMap((finding) => ("topic" in finding.next ? finding.next.topic : [])))
}

/** The triage of one engine, named by its id (never its address). */
export async function engineStatusForModel(
  client: Client,
  args: EngineStatusArgs,
  engineId: string,
) {
  // trimmed, unlike the contract's engineKeyList: a key of spaces names no definition either
  const keys = (args.processDefinitionKeyIn ?? []).filter((key) => key.trim() !== "")
  const data = await readStatus(
    { port: enginePortFor(client), now: () => Date.now() },
    { keys: [...new Set(keys)], maxGroups: MAX_STATUS_ROWS },
  )
  const notes = [...(data.truncated ?? [])]
  const named = namedTopics(data.findings)
  // the topics a finding names first (engine-core sorts them by name), so the cut keeps their rows
  const topics = [
    ...data.externalTasks.filter((row) => named.has(row.topic)),
    ...data.externalTasks.filter((row) => !named.has(row.topic)),
  ]
  return {
    ...data,
    statusRule: STATUS_RULE,
    engine: { id: engineId, ...data.engine },
    findings: data.findings.map(withoutNext),
    definitions: firstRows(data.definitions, MAX_STATUS_ROWS, "definitions", notes),
    incidents: data.incidents.map(withoutNext),
    externalTasks: firstRows(topics, MAX_STATUS_ROWS, "external-task topics", notes),
    ...(notes.length > 0 ? { truncated: notes } : {}),
  }
}
