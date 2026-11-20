import type { Variable } from "@miragon/pulse-engine-core"
import type {
  CalledInstanceRefData,
  IncidentCardData,
  PathRowData,
  VariableRowData,
  WaitRowData,
} from "../format/instance-screen-data.js"
import { DefinitionJson } from "./definition-json.js"
import type {
  CalledInstanceRef,
  IncidentCardModel,
  PathRowModel,
  WaitRowModel,
} from "./instance-screen-model.js"
import { Fields } from "./present.js"

interface WaitFacts {
  readonly dueAt?: string
  readonly assignee?: string
  readonly taskType?: string
  readonly retriesLeft?: number
  readonly messageName?: string
  readonly signalName?: string
  readonly description?: string
}

export class InstanceRowsJson {
  static card({
    incident,
    liesIn,
    text,
    rootCauseLine,
    causeSource,
  }: IncidentCardModel): IncidentCardData {
    const { id, instanceId, definition, elementId, type, message, createdAt, retriesLeft, job } =
      incident
    return {
      rootIncident: { id, instanceId, definition: DefinitionJson.of(definition) },
      liesIn: InstanceRowsJson.liesIn(liesIn),
      elementId,
      type,
      message,
      createdAt,
      ...Fields.present({ retriesLeft }),
      ...(job === undefined ? {} : { job: { id: job.id, ...Fields.present({ type: job.type }) } }),
      text: text ?? null,
      rootCauseLine: rootCauseLine ?? null,
      causeSource: causeSource ?? null,
    }
  }

  static wait({ wait, liesIn }: WaitRowModel): WaitRowData {
    const facts: WaitFacts = wait
    return {
      elementId: wait.elementId,
      kind: wait.kind,
      ...Fields.present({
        elementName: wait.elementName,
        since: wait.since,
        dueAt: facts.dueAt,
        incidentId: wait.incidentId,
        assignee: facts.assignee,
        taskType: facts.taskType,
        retriesLeft: facts.retriesLeft,
        messageName: facts.messageName,
        signalName: facts.signalName,
        description: facts.description,
      }),
      liesIn: InstanceRowsJson.liesIn(liesIn),
    }
  }

  static path({ run, state, durationMs }: PathRowModel): PathRowData {
    const { elementId, elementName, startedAt, endedAt } = run
    return { elementId, startedAt, state, ...Fields.present({ elementName, endedAt, durationMs }) }
  }

  static variable({ name, valueJson, truncated, type, kind, scope }: Variable): VariableRowData {
    return {
      name,
      valueJson,
      truncated,
      ...(scope.kind === "element" ? { scopeElementId: scope.elementId } : {}),
      ...Fields.present({ type, kind }),
    }
  }

  private static liesIn(liesIn: CalledInstanceRef | undefined): CalledInstanceRefData | null {
    if (liesIn === undefined) {
      return null
    }
    return {
      instanceId: liesIn.instanceId,
      ...Fields.present({ bpmnProcessId: liesIn.bpmnProcessId }),
    }
  }
}
