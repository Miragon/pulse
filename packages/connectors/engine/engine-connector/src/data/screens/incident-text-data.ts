/**
 * The text of a root incident for the web app's instance screen, read only when the reader opens
 * it: the engine contract's `getIncidentDetails` in any dialect (the job's stack trace or the
 * external task's error details on Camunda 7, the incident's error message on Camunda 8), with its
 * root cause and the index of the line it stands on, by engine-core's one rule (`RootCauses`),
 * which the dialect's core applies. A text longer than the cap is cut at a line's end and says so
 * (`truncated`), as one the engine cut does; a cause line beyond the cut is left out. An incident
 * the engine does not give a text for (gone, a copy at a call activity, no text at all) is a
 * refusal no retry changes (`UNKNOWN_INCIDENT`).
 */

import { IncidentId, type IncidentDetails } from "@miragon/pulse-engine-core"
import type { IncidentTextKind } from "@miragon/pulse-screens"
import { runtimeOf } from "../../lib/engine/engine-runtime.js"
import type { RuntimeEngine } from "../../lib/engine/resolve-engine.js"

/** The most of a text the feed carries: a stack trace's useful head is far shorter. */
export const INCIDENT_TEXT_CAP = 64 * 1024

/** The line breaks `RootCauses` splits a text at, so a line's index is the contract's. */
const LINE_BREAK = /\r\n|[\n\r]/g

/** The text feed's answer: the incident's text, its root cause and the line that cause stands on. */
export interface IncidentTextFeedData {
  readonly incidentId: string
  readonly kind: IncidentTextKind
  readonly text: string
  /** Whether the engine or the cap cut the text off. */
  readonly truncated: boolean
  readonly rootCause: string | null
  /** The index of the line the root cause stands on, null without one or beyond the cut. */
  readonly rootCauseLine: number | null
}

/** The refusal of an incident the engine gives no text for: no retry changes it. */
class UnknownIncidentError extends Error {
  readonly code = "UNKNOWN_INCIDENT" as const

  constructor(incidentId: string, engineId: string) {
    super(`Incident "${incidentId}" on engine "${engineId}" has no text the engine gives.`)
    this.name = "UnknownIncidentError"
  }
}

/** `text` cut to the cap at the end of the last whole line that fits, and how many lines it keeps. */
function capped(text: string): { readonly text: string; readonly lines: number } | undefined {
  if (text.length <= INCIDENT_TEXT_CAP) return undefined
  let end = 0
  let lines = 0
  for (const match of text.matchAll(LINE_BREAK)) {
    if (match.index > INCIDENT_TEXT_CAP) break
    end = match.index
    lines += 1
  }
  return end === 0
    ? { text: text.slice(0, INCIDENT_TEXT_CAP), lines: 1 }
    : { text: text.slice(0, end), lines }
}

/** The feed's answer for the details the engine gave. */
export function incidentTextOf(incidentId: string, details: IncidentDetails): IncidentTextFeedData {
  const cut = capped(details.text)
  const line = details.rootCauseLine
  const kept = line !== undefined && (cut === undefined || line < cut.lines)
  return {
    incidentId,
    kind: details.kind,
    text: cut?.text ?? details.text,
    truncated: details.truncated || cut !== undefined,
    rootCause: details.rootCause ?? null,
    rootCauseLine: kept ? line : null,
  }
}

/** The text of the root incident `incidentId` on `engine`. */
export async function buildIncidentTextData(
  engine: RuntimeEngine,
  incidentId: string,
): Promise<IncidentTextFeedData> {
  const details = await runtimeOf(engine).getIncidentDetails(IncidentId(incidentId))
  if (details === undefined) throw new UnknownIncidentError(incidentId, engine.engineId)
  return incidentTextOf(incidentId, details)
}
