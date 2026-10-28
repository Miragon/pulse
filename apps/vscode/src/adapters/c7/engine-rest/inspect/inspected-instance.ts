import { Present } from "../present.js"
import { DefinitionViewParser } from "../views/definition-view-parser.js"
import type { JsonObject } from "../views/json-object.js"
import { LosslessJson } from "../views/lossless-json.js"
import { UnexpectedAnswerError } from "../views/unexpected-answer-error.js"
import type {
  ChildInstanceView,
  DefinitionView,
  InspectView,
  InspectedIncidentView,
  VariableView,
} from "../views/views.js"
import { ActivityIndex } from "./activity-index.js"
import type { TreeNode } from "./instance-tree.js"
import { WaitStates, type WaitFacts } from "./wait-states.js"

export interface ActiveFacts extends Omit<WaitFacts, "instanceId"> {
  readonly runtime: JsonObject
  readonly parentId: string | undefined
  readonly truncated: boolean
  readonly definitions: readonly JsonObject[]
  readonly variables: readonly VariableView[]
  readonly timeline: readonly JsonObject[]
}

const PLAIN_TYPES: ReadonlySet<string> = new Set([
  "string",
  "boolean",
  "integer",
  "short",
  "long",
  "double",
  "null",
])
const STACKTRACE_LINE_CAP = 200
const COMPACT_OFFSET = /([+-]\d{2})(\d{2})$/

export class InspectedInstance {
  constructor(
    private readonly id: string,
    private readonly history: JsonObject | undefined,
  ) {}

  static rootIncidents(incidents: readonly JsonObject[]): JsonObject[] {
    return incidents
      .filter(
        (incident) =>
          incident.optionalString("rootCauseIncidentId") === incident.requiredString("id"),
      )
      .sort(
        (left, right) =>
          InspectedInstance.timeOf(left) - InspectedInstance.timeOf(right) ||
          ActivityIndex.compare(left.requiredString("id"), right.requiredString("id")),
      )
  }

  static variableOf(name: string, typed: JsonObject): VariableView {
    const type = typed.optionalString("type")
    const valueJson = LosslessJson.stringify(typed.value("value") ?? null)
    return type === undefined || PLAIN_TYPES.has(type.toLowerCase())
      ? { name, valueJson }
      : { name, valueJson, type }
  }

  ended(
    history: JsonObject,
    variables: readonly VariableView[],
    timeline: readonly JsonObject[],
  ): InspectView {
    return {
      ...this.header(InspectedInstance.historicDefinition(history), undefined),
      state: history.optionalString("state") ?? "COMPLETED",
      waitingAt: [],
      incidents: [],
      propagatedIncidents: 0,
      children: [],
      ...InspectedInstance.pathOf(timeline),
      variables,
      truncated: false,
    }
  }

  active(facts: ActiveFacts, causes: ReadonlyMap<string, string>): InspectView {
    const roots = InspectedInstance.rootIncidents(facts.incidents)
    return {
      ...this.header(this.definitionOf(facts), facts),
      state: facts.runtime.value("suspended") === true ? "SUSPENDED" : "ACTIVE",
      waitingAt: new WaitStates({ instanceId: this.id, ...facts }).all(),
      incidents: roots.map((incident) =>
        this.incidentOf(incident, causes.get(incident.requiredString("id"))),
      ),
      propagatedIncidents: facts.incidents.length - roots.length,
      children: this.childrenOf(facts.tree),
      ...InspectedInstance.pathOf(facts.timeline),
      variables: facts.variables,
      truncated: facts.truncated,
    }
  }

  private header(definition: DefinitionView, facts: ActiveFacts | undefined) {
    const history = this.history
    return {
      id: this.id,
      definition,
      ...Present.fields({
        businessKey:
          history?.optionalString("businessKey") ?? facts?.runtime.optionalString("businessKey"),
        startTime: history?.optionalString("startTime"),
        endTime: history?.optionalString("endTime"),
        parentId: history?.optionalString("superProcessInstanceId") ?? facts?.parentId,
      }),
    }
  }

  private static historicDefinition(history: JsonObject): DefinitionView {
    return {
      id: history.requiredString("processDefinitionId"),
      key: history.requiredString("processDefinitionKey"),
      version: history.requiredNumber("processDefinitionVersion"),
      ...Present.fields({ name: history.optionalString("processDefinitionName") }),
    }
  }

  private definitionOf(facts: ActiveFacts): DefinitionView {
    if (this.history !== undefined) {
      return InspectedInstance.historicDefinition(this.history)
    }
    const id = facts.runtime.requiredString("definitionId")
    const definition = facts.definitions.find((candidate) => candidate.optionalString("id") === id)
    if (definition === undefined) {
      throw new UnexpectedAnswerError(`definition ${id} is missing`)
    }
    return DefinitionViewParser.definition(definition)
  }

  private incidentOf(incident: JsonObject, cause: string | undefined): InspectedIncidentView {
    const type = incident.requiredString("incidentType")
    const processInstanceId = incident.optionalString("processInstanceId")
    const configuration = incident.optionalString("configuration")
    const lines = cause?.trimEnd().split(/\r?\n/).slice(0, STACKTRACE_LINE_CAP)
    return {
      id: incident.requiredString("id"),
      type,
      activityId: incident.requiredString("activityId"),
      since: incident.requiredString("incidentTimestamp"),
      ...Present.fields({
        processInstanceId: processInstanceId === this.id ? undefined : processInstanceId,
        message: incident.optionalString("incidentMessage"),
        jobId: type === "failedJob" ? configuration : undefined,
        externalTaskId: type === "failedExternalTask" ? configuration : undefined,
        stacktrace:
          lines === undefined || cause?.trim() === ""
            ? undefined
            : { lines, truncated: lines.length >= STACKTRACE_LINE_CAP },
      }),
    }
  }

  private childrenOf(tree: readonly TreeNode[]): ChildInstanceView[] {
    return tree
      .filter((node) => node.depth > 0)
      .sort(
        (left, right) =>
          left.depth - right.depth ||
          ActivityIndex.compare(left.key, right.key) ||
          ActivityIndex.compare(left.id, right.id),
      )
      .map((node) => ({
        id: node.id,
        parentId: node.parentId ?? this.id,
        key: node.key,
        state: node.suspended ? "SUSPENDED" : "ACTIVE",
      }))
  }

  private static pathOf(timeline: readonly JsonObject[]): Pick<InspectView, "timeline" | "calls"> {
    return {
      timeline: timeline.map((entry) => ({
        activityId: entry.requiredString("activityId"),
        startTime: entry.requiredString("startTime"),
        canceled: entry.value("canceled") === true,
        ...Present.fields({
          activityName: entry.optionalString("activityName"),
          endTime: entry.optionalString("endTime"),
        }),
      })),
      calls: timeline.flatMap((entry) => {
        const calledProcessInstanceId = entry.optionalString("calledProcessInstanceId")
        return calledProcessInstanceId === undefined
          ? []
          : [{ activityId: entry.requiredString("activityId"), calledProcessInstanceId }]
      }),
    }
  }

  private static timeOf(incident: JsonObject): number {
    const timestamp = incident.requiredString("incidentTimestamp").replace(COMPACT_OFFSET, "$1:$2")
    return Date.parse(timestamp)
  }
}
