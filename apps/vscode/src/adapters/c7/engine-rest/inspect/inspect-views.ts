import {
  MAX_STACKTRACE_LINES,
  type ChildView,
  type DefinitionView as CoreDefinitionView,
  type IncidentView,
  type InstanceView,
} from "@miragon/pulse-engine-core"
import { Present } from "../present.js"
import { JsonObject } from "../views/json-object.js"
import { LosslessJson } from "../views/lossless-json.js"
import { UnexpectedAnswerError } from "../views/unexpected-answer-error.js"
import type {
  ChildInstanceView,
  DefinitionView,
  InspectedIncidentView,
  InspectView,
  VariableView,
} from "../views/views.js"
import { InstancePath } from "./instance-path.js"
import { WaitingAtViews } from "./waiting-at-views.js"

export class InspectViews {
  static of(view: InstanceView, timeline: readonly JsonObject[]): InspectView {
    return {
      id: view.id,
      definition: InspectViews.definitionOf(view.definition),
      state: view.state,
      ...Present.fields({
        businessKey: view.businessKey,
        startTime: view.startTime,
        endTime: view.endTime,
        parentId: view.parentId,
      }),
      waitingAt: view.waitingAt.map((wait) => WaitingAtViews.of(wait)),
      incidents: view.incidents.map((incident) => InspectViews.incidentOf(incident)),
      propagatedIncidents: view.propagatedIncidents ?? 0,
      children: view.children.map((child) => InspectViews.childOf(child)),
      ...InstancePath.of(timeline),
      variables: Object.entries(view.variables ?? {}).map(([name, value]) =>
        InspectViews.variableOf(name, value),
      ),
      truncated: view.truncated === true,
    }
  }

  private static definitionOf(definition: CoreDefinitionView): DefinitionView {
    if (definition.version === undefined) {
      throw new UnexpectedAnswerError(`definition ${definition.id} is missing`)
    }
    return {
      id: definition.id,
      key: definition.key,
      version: definition.version,
      ...Present.fields({ name: definition.name }),
    }
  }

  private static incidentOf(incident: IncidentView): InspectedIncidentView {
    const lines = incident.stacktrace
    return {
      id: incident.id,
      type: incident.type,
      activityId: incident.activityId,
      since: incident.since,
      ...Present.fields({
        processInstanceId: incident.processInstanceId,
        message: incident.message,
        jobId: incident.jobId,
        externalTaskId: incident.externalTaskId,
        stacktrace:
          lines === undefined
            ? undefined
            : { lines, truncated: lines.length >= MAX_STACKTRACE_LINES },
      }),
    }
  }

  private static childOf(child: ChildView): ChildInstanceView {
    return { id: child.id, parentId: child.parentId, key: child.key, state: child.state }
  }

  private static variableOf(name: string, value: unknown): VariableView {
    const typed = JsonObject.ifObject(value)
    const type = typed?.value("type")
    if (typed === undefined || typeof type !== "string") {
      return { name, valueJson: LosslessJson.stringify(value) }
    }
    return {
      name,
      valueJson: LosslessJson.stringify(typed.value("value") ?? null),
      ...Present.fields({ type: type === "" ? undefined : type }),
    }
  }
}
