/** How `pulse-cli auth status` prints: the view as JSON or KEY VALUE rows on stdout. */

import { renderValue } from "../../output/render.js"
import type { Runtime } from "../../runtime.js"
import type { Display } from "../display.js"
import { maxWidthOf } from "../output-format.js"
import type { Session } from "../session.js"
import type { BearerStatusView } from "./auth-bearer.js"

export type Format = Pick<Display, "format" | "pretty" | "maxWidth">

export function withWidth(session: Session, runtime: Runtime): Format {
  return { ...session, maxWidth: maxWidthOf(runtime) }
}

/** Rows of the table format: KEY VALUE; lists space-joined, null empty. */
export function viewRows(view: object): Record<string, unknown>[] {
  return Object.entries(view).map(([key, value]: [string, unknown]) => ({
    KEY: key,
    VALUE: Array.isArray(value) ? value.join(" ") : (value ?? ""),
  }))
}

export function printView(view: BearerStatusView, display: Format, runtime: Runtime): void {
  const value = display.format === "json" ? view : viewRows(view)
  runtime.stdout.write(renderValue(value, display))
}
