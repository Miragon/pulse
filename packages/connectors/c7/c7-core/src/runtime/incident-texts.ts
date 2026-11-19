/**
 * The details of an incident (`IncidentDetails` of @miragon/pulse-engine-core) with the root cause
 * of their text, by engine-core's one rule (`RootCauses`), so every caller shows the same cause
 * and opens the text at the same line. Pure.
 */

import { type IncidentDetails, RootCauses } from "@miragon/pulse-engine-core"
import { compact } from "../util.js"

/** The details of `text`, a stack trace or an error message, with its root cause and its line. */
export function incidentDetailsOf(
  kind: IncidentDetails["kind"],
  text: string,
  truncated: boolean,
): IncidentDetails {
  return {
    kind,
    text,
    truncated,
    ...compact({ rootCause: RootCauses.of(text), rootCauseLine: RootCauses.lineOf(text) }),
  }
}
