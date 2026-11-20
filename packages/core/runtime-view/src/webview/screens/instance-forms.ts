import type {
  IncidentCardFields,
  InstanceFactsData,
  InstanceFactsProps,
  WaitingTableProps,
} from "@miragon/pulse-blocks"
import type {
  CalledInstanceLink,
  CauseLabel,
  IncidentRow,
  InstanceHeader,
  WaitRow,
} from "../../core/protocol/index.js"

type WaitForm = WaitingTableProps["waits"][number]

type CallerForm = InstanceFactsProps["caller"]

type CalledForm = IncidentCardFields["liesIn"]

const CAUSE_SOURCES: Readonly<Record<CauseLabel, NonNullable<IncidentCardFields["causeSource"]>>> =
  {
    "Root cause": "stacktrace",
    "Worker error": "workerError",
    Cause: "errorMessage",
  }

const WAIT_KINDS: Readonly<Partial<Record<string, WaitForm["kind"]>>> = {
  "User task": "userTask",
  "Worker task": "workerTask",
  "Async continuation": "asyncContinuation",
  Timer: "timer",
  Message: "message",
  Signal: "signal",
}

export class InstanceForms {
  static facts(header: InstanceHeader): InstanceFactsData {
    return {
      id: header.id,
      definition: {
        id: header.definitionId,
        bpmnProcessId: header.bpmnProcessId,
        version: header.version,
        name: header.processName,
      },
      ...(header.businessKey === undefined ? {} : { businessKey: header.businessKey }),
      ...(header.startedAt === undefined ? {} : { startedAt: header.startedAt }),
      ...(header.endedAt === undefined ? {} : { endedAt: header.endedAt }),
    }
  }

  static caller(header: InstanceHeader): CallerForm {
    return header.parent === undefined
      ? null
      : { instanceId: header.parent.instanceId, found: null }
  }

  static incident(row: IncidentRow): IncidentCardFields {
    return {
      rootIncident: { id: row.id },
      liesIn: InstanceForms.called(row.inCalledInstance),
      elementId: row.elementId,
      type: row.engineType,
      message: row.message,
      createdAt: row.createdAt,
      rootCauseLine: row.rootCause ?? null,
      causeSource: row.rootCause === undefined ? null : CAUSE_SOURCES[row.causeLabel ?? "Cause"],
      ...(row.retriesLeft === undefined ? {} : { retriesLeft: row.retriesLeft }),
      ...(row.job === undefined ? {} : { job: InstanceForms.job(row.job) }),
    }
  }

  static wait(row: WaitRow): WaitForm {
    const { elementId, elementName, since, dueAt, calledInstance } = row
    return {
      elementId,
      kind: WAIT_KINDS[row.kindLabel] ?? "other",
      liesIn: InstanceForms.called(calledInstance),
      ...(elementName === undefined ? {} : { elementName }),
      ...(since === undefined ? {} : { since }),
      ...(dueAt === undefined ? {} : { dueAt }),
      ...InstanceForms.waitFacts(row),
    }
  }

  private static waitFacts(row: WaitRow): Partial<WaitForm> {
    const { assignee, taskType, retriesLeft, messageName, signalName, description } = row
    return {
      ...(assignee === undefined ? {} : { assignee }),
      ...(taskType === undefined ? {} : { taskType }),
      ...(retriesLeft === undefined ? {} : { retriesLeft }),
      ...(messageName === undefined ? {} : { messageName }),
      ...(signalName === undefined ? {} : { signalName }),
      ...(description === undefined ? {} : { description }),
    }
  }

  private static job(job: NonNullable<IncidentRow["job"]>): NonNullable<IncidentCardFields["job"]> {
    return { id: job.id, ...(job.type === undefined ? {} : { type: job.type }) }
  }

  private static called(link: CalledInstanceLink | undefined): CalledForm {
    if (link === undefined) {
      return null
    }
    return {
      instanceId: link.instanceId,
      ...(link.bpmnProcessId === "" ? {} : { bpmnProcessId: link.bpmnProcessId }),
    }
  }
}
