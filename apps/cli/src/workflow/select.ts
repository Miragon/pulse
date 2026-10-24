/**
 * Instance selection of inspect, wait, advance and retry: a process instance id,
 * or `--business-key` / `--process-definition-key` (with `--latest`) resolved against history
 * and runtime.
 */

import type { EnginePort, PlannedRequest } from "../engine-port/engine-port.js"
import { OperateError, usageError } from "../errors.js"
import { compact } from "../util.js"
import { json, queryInput } from "./engine.js"
import {
  compareText,
  definitionKeyOf,
  engineTime,
  num,
  type Rec,
  records,
  str,
  yes,
} from "./records.js"

export interface Selection {
  readonly id?: string
  readonly businessKey?: string
  readonly processDefinitionKey?: string
  readonly latest: boolean
  /**
   * The other words of the command line, shell quoted: the ready commands of an ambiguous
   * selection keep them, so a copied command does what the original would have done.
   */
  readonly options?: readonly string[]
}

export interface Candidate {
  readonly id: string
  readonly key?: string
  readonly version?: number
  readonly businessKey?: string
  readonly state: string
  readonly startTime?: string
}

/** One match more than the candidates an error lists tells "more than 10". */
const MATCH_LIMIT = 11
const LISTED_CANDIDATES = 10
const READY_COMMANDS = 3
const ACTIVE_STATES: ReadonlySet<string> = new Set(["ACTIVE", "SUSPENDED"])

const SELECTION_HINT =
  "Pass a process instance id, --business-key <key> (optionally with --process-definition-key <key>), or --process-definition-key <key> --latest."

/** Usage errors of the selection options; nothing is sent before this passed. */
export function checkSelection(selection: Selection): void {
  const filtered =
    selection.businessKey !== undefined || selection.processDefinitionKey !== undefined
  if (selection.id !== undefined && (filtered || selection.latest)) {
    throw usageError(
      "The process instance id excludes --business-key, --process-definition-key and --latest",
      SELECTION_HINT,
    )
  }
  if (selection.id === undefined && !filtered) {
    throw usageError(
      selection.latest
        ? "--latest needs --business-key or --process-definition-key"
        : "Select a process instance",
      SELECTION_HINT,
    )
  }
}

function historyRequest(selection: Selection): PlannedRequest {
  return {
    operationId: "getHistoricProcessInstances",
    input: queryInput({
      processInstanceBusinessKey: selection.businessKey,
      processDefinitionKey: selection.processDefinitionKey,
      sortBy: "startTime",
      sortOrder: "desc",
      maxResults: String(MATCH_LIMIT),
    }),
  }
}

function runtimeRequest(selection: Selection): PlannedRequest {
  return {
    operationId: "getProcessInstances",
    input: queryInput({
      businessKey: selection.businessKey,
      processDefinitionKey: selection.processDefinitionKey,
      maxResults: String(MATCH_LIMIT),
    }),
  }
}

/** The requests that resolve the filters (history, runtime); none for an id. */
export function selectionRequests(selection: Selection): PlannedRequest[] {
  return selection.id === undefined ? [historyRequest(selection), runtimeRequest(selection)] : []
}

function fromHistory(row: Rec): Candidate | undefined {
  const id = str(row, "id")
  if (id === undefined) return undefined
  return {
    id,
    ...compact({
      key: str(row, "processDefinitionKey"),
      version: num(row, "processDefinitionVersion"),
      businessKey: str(row, "businessKey"),
    }),
    state: str(row, "state") ?? "ACTIVE",
    ...compact({ startTime: str(row, "startTime") }),
  }
}

function fromRuntime(row: Rec): Candidate | undefined {
  const id = str(row, "id")
  if (id === undefined) return undefined
  const key = str(row, "definitionKey") ?? definitionKeyOf(str(row, "definitionId"))
  return {
    id,
    ...compact({ key, businessKey: str(row, "businessKey") }),
    state: yes(row, "suspended") ? "SUSPENDED" : "ACTIVE",
  }
}

function rank(candidate: Candidate): number {
  return ACTIVE_STATES.has(candidate.state) ? 0 : 1
}

/** Start time for a descending order; candidates without one (runtime only) come last. */
function startedAt(candidate: Candidate): number {
  return engineTime(candidate.startTime) ?? Number.NEGATIVE_INFINITY
}

/** Merged by id (history first), active before ended, then the most recently started first. */
export function mergeCandidates(history: readonly Rec[], runtime: readonly Rec[]): Candidate[] {
  const merged = new Map<string, Candidate>()
  for (const candidate of [...history.map(fromHistory), ...runtime.map(fromRuntime)]) {
    if (candidate !== undefined && !merged.has(candidate.id)) merged.set(candidate.id, candidate)
  }
  return [...merged.values()].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      startedAt(right) - startedAt(left) ||
      compareText(left.id, right.id),
  )
}

/** `business key "B-1"`, `process definition key "k"` or both. */
function filterText(selection: Selection): string {
  const parts = [
    selection.businessKey === undefined ? undefined : `business key "${selection.businessKey}"`,
    selection.processDefinitionKey === undefined
      ? undefined
      : `process definition key "${selection.processDefinitionKey}"`,
  ].filter((part) => part !== undefined)
  return parts.join(" and ")
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`
}

function notFound(selection: Selection): OperateError {
  return new OperateError("NOT_FOUND", `No process instance with ${filterText(selection)}`, {
    hint: "Check the filters with `pulse-cli process-instance list` (running instances) and `pulse-cli historic-process-instance list` (also ended ones); with history level none, ended instances cannot be found.",
  })
}

function ambiguous(selection: Selection, candidates: readonly Candidate[], command: string) {
  const both = selection.businessKey !== undefined && selection.processDefinitionKey !== undefined
  const count = candidates.length > LISTED_CANDIDATES ? "more than 10" : String(candidates.length)
  const options = selection.options?.map((word) => ` ${word}`).join("") ?? ""
  const ready = candidates
    .slice(0, READY_COMMANDS)
    .map((candidate) => `pulse-cli ${command} ${candidate.id}${options}`)
  return new OperateError(
    "USAGE",
    `${capitalized(filterText(selection))} ${both ? "match" : "matches"} ${count} process instances`,
    {
      hint: `Choose one: ${ready.join(", ")}; or narrow the selection with --process-definition-key <key>, or take the most recently started one with --latest.`,
      data: { candidates: candidates.slice(0, LISTED_CANDIDATES) },
    },
  )
}

function latestOf(history: readonly Rec[], runtime: readonly Rec[], selection: Selection) {
  const first = history.map(fromHistory).find((candidate) => candidate !== undefined)
  if (first !== undefined) return first.id
  const running = mergeCandidates([], runtime)
  if (running.length > 1) {
    throw usageError(
      "--latest needs the history (level activity or higher) to order instances",
      "Pass the process instance id instead; `pulse-cli process-instance list` lists the running ones.",
    )
  }
  const [only] = running
  if (only === undefined) throw notFound(selection)
  return only.id
}

/** The id of the selected instance; filters are resolved in parallel against history and runtime. */
export async function selectInstance(
  port: EnginePort,
  selection: Selection,
  command: string,
): Promise<string> {
  checkSelection(selection)
  if (selection.id !== undefined) return selection.id
  const load = async (request: PlannedRequest) =>
    records(await json(port, request.operationId, request.input))
  const [history, runtime] = await Promise.all([
    load(historyRequest(selection)),
    load(runtimeRequest(selection)),
  ])
  if (selection.latest) return latestOf(history, runtime, selection)
  const candidates = mergeCandidates(history, runtime)
  const [only, ...others] = candidates
  if (only === undefined) throw notFound(selection)
  if (others.length > 0) throw ambiguous(selection, candidates, command)
  return only.id
}
