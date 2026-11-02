/**
 * Instance selection: a process instance id, or a business key and/or a process definition key
 * (with `latest`) resolved against history and runtime.
 */

import { WorkflowError } from "./errors.js"
import type { EnginePort, PlannedRequest } from "./port.js"
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
import { queryInput } from "./requests.js"
import type { Candidate, Selection } from "./types.js"
import { compact } from "./util.js"

/** The candidates an ambiguous selection names at most. */
const LISTED_CANDIDATES = 10
/** One match more than the listed candidates tells whether the engine has more. */
const MATCH_LIMIT = LISTED_CANDIDATES + 1
const ACTIVE_STATES: ReadonlySet<string> = new Set(["ACTIVE", "SUSPENDED"])

/** The rules of a selection; nothing is sent before this passed. */
export function checkSelection(selection: Selection): void {
  const filtered =
    selection.businessKey !== undefined || selection.processDefinitionKey !== undefined
  if (selection.id !== undefined && (filtered || selection.latest)) {
    throw new WorkflowError({ kind: "selection-conflict" })
  }
  if (selection.id === undefined && !filtered) {
    throw new WorkflowError({ kind: "selection-missing", latest: selection.latest })
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

function latestOf(history: readonly Rec[], runtime: readonly Rec[], selection: Selection) {
  const first = history.map(fromHistory).find((candidate) => candidate !== undefined)
  if (first !== undefined) return first.id
  const running = mergeCandidates([], runtime)
  if (running.length > 1) throw new WorkflowError({ kind: "latest-needs-history" })
  const [only] = running
  if (only === undefined) throw new WorkflowError({ kind: "selection-not-found", selection })
  return only.id
}

/** The id of the selected instance; filters are resolved in parallel against history and runtime. */
export async function selectInstance(port: EnginePort, selection: Selection): Promise<string> {
  checkSelection(selection)
  if (selection.id !== undefined) return selection.id
  const load = async (request: PlannedRequest) =>
    records(await port.json(request.operationId, request.input))
  const [history, runtime] = await Promise.all([
    load(historyRequest(selection)),
    load(runtimeRequest(selection)),
  ])
  if (selection.latest) return latestOf(history, runtime, selection)
  const candidates = mergeCandidates(history, runtime)
  const [only, ...others] = candidates
  if (only === undefined) throw new WorkflowError({ kind: "selection-not-found", selection })
  if (others.length > 0) {
    throw new WorkflowError({
      kind: "selection-ambiguous",
      selection,
      candidates: candidates.slice(0, LISTED_CANDIDATES),
      more: candidates.length > LISTED_CANDIDATES,
    })
  }
  return only.id
}
