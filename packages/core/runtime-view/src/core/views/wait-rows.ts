import type { WaitKindCode, WaitRowData } from "@miragon/pulse-screens"
import type { WaitRow } from "../protocol/index.js"
import { CalledInstanceLinks } from "./called-instance-links.js"
import { Labels } from "./labels.js"

const DETAILS: Readonly<Record<WaitKindCode, (wait: WaitRowData) => string | undefined>> = {
  userTask: ({ assignee }) => (assignee === undefined ? "Unassigned" : `Assigned to ${assignee}`),
  workerTask: ({ taskType }) => `Task type ${taskType ?? ""}`,
  asyncContinuation: ({ retriesLeft }) =>
    retriesLeft === undefined ? undefined : `${String(retriesLeft)} retries left`,
  message: ({ messageName }) => messageName,
  signal: ({ signalName }) => signalName,
  other: ({ description }) => description,
  timer: () => undefined,
}

export class WaitRows {
  static of(waits: readonly WaitRowData[]): WaitRow[] {
    return waits.map((wait) => WaitRows.rowOf(wait))
  }

  private static rowOf(wait: WaitRowData): WaitRow {
    const text = DETAILS[wait.kind](wait)
    return {
      elementId: wait.elementId,
      kindLabel: Labels.waitKind(wait.kind),
      ...(wait.elementName === undefined ? {} : { elementName: wait.elementName }),
      ...(text === undefined ? {} : { detail: text }),
      ...(wait.since === undefined ? {} : { since: wait.since }),
      ...(wait.dueAt === undefined ? {} : { dueAt: wait.dueAt }),
      ...(wait.liesIn === null ? {} : { calledInstance: CalledInstanceLinks.of(wait.liesIn) }),
    }
  }
}
