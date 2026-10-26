import { Present } from "../present.js"
import { DefinitionViewParser } from "./definition-view-parser.js"
import { JsonObject } from "./json-object.js"
import { LosslessJson } from "./lossless-json.js"
import type {
  CallView,
  ChildInstanceView,
  InspectView,
  InspectedIncidentView,
  StacktraceView,
  TimelineEntryView,
  VariableView,
  WaitingAtView,
} from "./views.js"

export const INSPECT_STACKTRACE_LINE_CAP = 200

export class InspectViewParser {
  static view(value: unknown): InspectView {
    const view = JsonObject.of(value, "instance view")
    return {
      id: view.requiredString("id"),
      definition: DefinitionViewParser.definition(view.object("definition", "instance definition")),
      state: view.requiredString("state"),
      waitingAt: view
        .optionalList("waitingAt")
        .map((record) => InspectViewParser.waitingAtOf(record)),
      incidents: view
        .optionalList("incidents")
        .map((record) => InspectViewParser.inspectedIncidentOf(record)),
      propagatedIncidents: view.optionalNumber("propagatedIncidents") ?? 0,
      children: view.optionalList("children").map((record) => InspectViewParser.childOf(record)),
      calls: InspectViewParser.callsOf(view),
      timeline: view
        .optionalList("timeline")
        .map((entry) => InspectViewParser.timelineEntryOf(entry)),
      variables: InspectViewParser.variablesOf(view),
      truncated: view.value("truncated") === true,
      ...Present.fields({
        businessKey: view.optionalString("businessKey"),
        startTime: view.optionalString("startTime"),
        endTime: view.optionalString("endTime"),
        parentId: view.optionalString("parentId"),
      }),
    }
  }

  private static waitingAtOf(record: JsonObject): WaitingAtView {
    return {
      kind: record.requiredString("kind"),
      activityId: record.requiredString("activityId"),
      ...Present.fields({
        activityName: record.optionalString("activityName"),
        activityType: record.optionalString("activityType"),
        attachedTo: record.optionalString("attachedTo"),
        processInstanceId: record.optionalString("processInstanceId"),
        since: record.optionalString("since"),
        incidentId: record.optionalString("incidentId"),
        assignee: record.optionalString("assignee"),
        due: record.optionalString("due"),
        dueDate: record.optionalString("dueDate"),
        topic: record.optionalString("topic"),
        retries: record.optionalNumber("retries"),
        eventName: record.optionalString("eventName"),
      }),
    }
  }

  private static stacktraceOf(record: JsonObject): StacktraceView | undefined {
    const lines = record.optionalStrings("stacktrace")
    return lines === undefined
      ? undefined
      : { lines, truncated: lines.length >= INSPECT_STACKTRACE_LINE_CAP }
  }

  private static inspectedIncidentOf(record: JsonObject): InspectedIncidentView {
    return {
      id: record.requiredString("id"),
      type: record.requiredString("type"),
      activityId: record.requiredString("activityId"),
      since: record.requiredString("since"),
      ...Present.fields({
        processInstanceId: record.optionalString("processInstanceId"),
        message: record.optionalString("message"),
        jobId: record.optionalString("jobId"),
        externalTaskId: record.optionalString("externalTaskId"),
        stacktrace: InspectViewParser.stacktraceOf(record),
      }),
    }
  }

  private static childOf(record: JsonObject): ChildInstanceView {
    return {
      id: record.requiredString("id"),
      parentId: record.requiredString("parentId"),
      key: record.requiredString("key"),
      state: record.requiredString("state"),
    }
  }

  private static timelineEntryOf(entry: JsonObject): TimelineEntryView {
    return {
      activityId: entry.requiredString("activityId"),
      startTime: entry.requiredString("startTime"),
      canceled: entry.value("canceled") === true,
      ...Present.fields({
        activityName: entry.optionalString("activityName"),
        endTime: entry.optionalString("endTime"),
      }),
    }
  }

  private static callsOf(view: JsonObject): CallView[] {
    return view.optionalList("timeline").flatMap((entry) => {
      const calledProcessInstanceId = entry.optionalString("calledProcessInstanceId")
      return calledProcessInstanceId === undefined
        ? []
        : [{ activityId: entry.requiredString("activityId"), calledProcessInstanceId }]
    })
  }

  private static variableOf(name: string, value: unknown): VariableView {
    const typed = JsonObject.ifObject(value)
    if (typed === undefined) {
      return { name, valueJson: LosslessJson.stringify(value) }
    }
    return {
      name,
      valueJson: LosslessJson.stringify(typed.value("value") ?? null),
      ...Present.fields({ type: typed.optionalString("type") }),
    }
  }

  private static variablesOf(view: JsonObject): VariableView[] {
    const variables = view.value("variables")
    if (variables === undefined || variables === null) {
      return []
    }
    return JsonObject.of(variables, "variables")
      .entries()
      .map(([name, value]) => InspectViewParser.variableOf(name, value))
  }
}
