import {
  BpmnProcessId,
  ElementId,
  IncidentId,
  InstanceId,
  ValueKinds,
  type CalledInstance,
  type DefinitionRef,
  type Incident,
  type IncidentJob,
  type InstanceDetail,
  type InstanceSummary,
  type ValueKind,
  type Variable,
  type WaitState,
} from "../../../contract/index.js"
import { ErrorTranslation } from "../errors/error-translation.js"
import { DefinitionRefs } from "../mapping/definition-refs.js"
import { InstanceStates } from "../mapping/instance-states.js"
import { Timestamps } from "../mapping/timestamps.js"
import {
  Present,
  VARIABLE_PAGE_SIZE,
  type ChildInstanceView,
  type EngineClient,
  type InspectedIncidentView,
  type InspectView,
  type VariableView,
  type WaitingAtView,
} from "../engine-rest/index.js"

type DefinitionsByInstance = ReadonlyMap<string, DefinitionRef>

const KIND_OF_TYPE: ReadonlyMap<string, ValueKind> = new Map<string, ValueKind>([
  ["String", "string"],
  ["Short", "integer"],
  ["Integer", "integer"],
  ["Long", "integer"],
  ["Double", "decimal"],
  ["Boolean", "boolean"],
  ["Date", "date"],
  ["Json", "json"],
  ["Null", "null"],
])

export class InstanceDetailReader {
  constructor(private readonly client: EngineClient) {}

  async read(instanceId: InstanceId): Promise<InstanceDetail | undefined> {
    const [view, typedVariables] = await Promise.all([
      ErrorTranslation.unlessMissing(() => this.client.inspect(instanceId)),
      this.client.variables(instanceId).catch(() => undefined),
    ])
    if (view === undefined) {
      return undefined
    }
    return this.detailOf(view, await this.definitionsOfIncidentInstances(view), typedVariables)
  }

  private async definitionsOfIncidentInstances(view: InspectView): Promise<DefinitionsByInstance> {
    const definitions = new Map([[view.id, DefinitionRefs.of(view.definition)]])
    const calledIds = view.incidents
      .map((incident) => incident.processInstanceId)
      .filter(
        (instanceId): instanceId is string => instanceId !== undefined && instanceId !== view.id,
      )
    if (calledIds.length > 0) {
      const called = [...new Set(calledIds)]
      const rows = await this.client.historicInstances(
        { processInstanceIds: called },
        { firstResult: 0, maxResults: called.length },
      )
      for (const row of rows) {
        definitions.set(row.id, DefinitionRefs.ofInstance(row))
      }
    }
    return definitions
  }

  private detailOf(
    view: InspectView,
    definitions: DefinitionsByInstance,
    typedVariables: readonly VariableView[] | undefined,
  ): InstanceDetail {
    const waitStates = view.waitingAt.map((wait) => this.waitStateOf(wait, view.id))
    const instance = this.summaryOf(view)
    return {
      instance,
      path: view.timeline.map((entry) => ({
        elementId: ElementId(entry.activityId),
        startedAt: Timestamps.fromEngine(entry.startTime),
        canceled: entry.canceled,
        ...Present.fields({
          elementName: entry.activityName,
          endedAt: Timestamps.optional(entry.endTime),
        }),
      })),
      waitStates,
      incidents: view.incidents.flatMap(
        (incident) => this.incidentOf(incident, { view, definitions, waitStates }) ?? [],
      ),
      calledInstances: view.children.map((child) => this.calledInstanceOf(child, view)),
      variables: this.variablesOf(instance, view, typedVariables),
      truncated: view.truncated || (typedVariables?.length ?? 0) >= VARIABLE_PAGE_SIZE,
    }
  }

  private summaryOf(view: InspectView): InstanceSummary {
    return {
      id: InstanceId(view.id),
      definition: DefinitionRefs.of(view.definition),
      state: InstanceStates.of(view.state),
      hasIncident: view.incidents.length > 0 || view.propagatedIncidents > 0,
      ...Present.fields({
        businessKey: view.businessKey,
        startedAt: Timestamps.optional(view.startTime),
        endedAt: Timestamps.optional(view.endTime),
        parentInstanceId: view.parentId === undefined ? undefined : InstanceId(view.parentId),
      }),
    }
  }

  private waitStateOf(wait: WaitingAtView, inspectedInstanceId: string): WaitState {
    const base = this.waitBaseOf(wait, inspectedInstanceId)
    const retries = Present.fields({ retriesLeft: wait.retries })
    switch (wait.kind) {
      case "userTask":
        return {
          ...base,
          kind: "userTask",
          ...Present.fields({ assignee: wait.assignee, dueAt: Timestamps.optional(wait.due) }),
        }
      case "externalTask":
        return { ...base, kind: "workerTask", taskType: wait.topic ?? "", ...retries }
      case "asyncContinuation":
        return { ...base, kind: "asyncContinuation", ...retries }
      case "timer":
        return {
          ...base,
          kind: "timer",
          ...Present.fields({ dueAt: Timestamps.optional(wait.dueDate) }),
        }
      case "message":
        return { ...base, kind: "message", ...Present.fields({ messageName: wait.eventName }) }
      case "signal":
        return { ...base, kind: "signal", ...Present.fields({ signalName: wait.eventName }) }
      default:
        return { ...base, kind: "other", description: wait.activityType ?? wait.kind }
    }
  }

  private waitBaseOf(wait: WaitingAtView, inspectedInstanceId: string) {
    return {
      instanceId: InstanceId(wait.processInstanceId ?? inspectedInstanceId),
      elementId: ElementId(wait.activityId),
      ...Present.fields({
        elementName: wait.activityName,
        attachedToElementId: wait.attachedTo === undefined ? undefined : ElementId(wait.attachedTo),
        since: Timestamps.optional(wait.since),
        incidentId: wait.incidentId === undefined ? undefined : IncidentId(wait.incidentId),
      }),
    }
  }

  private incidentOf(
    incident: InspectedIncidentView,
    facts: {
      view: InspectView
      definitions: DefinitionsByInstance
      waitStates: readonly WaitState[]
    },
  ): Incident | undefined {
    const instanceId = incident.processInstanceId ?? facts.view.id
    const definition = facts.definitions.get(instanceId)
    if (definition === undefined) {
      return undefined
    }
    const waiting = facts.waitStates.find((wait) => wait.incidentId === IncidentId(incident.id))
    const stacktrace = incident.stacktrace
    return {
      id: IncidentId(incident.id),
      instanceId: InstanceId(instanceId),
      definition,
      elementId: ElementId(incident.activityId),
      type: incident.type,
      message: incident.message ?? "",
      createdAt: Timestamps.fromEngine(incident.since),
      ...Present.fields({
        retriesLeft:
          waiting !== undefined && "retriesLeft" in waiting ? waiting.retriesLeft : undefined,
        job: this.jobOf(incident, facts.view),
        details:
          stacktrace === undefined
            ? undefined
            : ({
                kind: "stacktrace",
                text: stacktrace.lines.join("\n"),
                truncated: stacktrace.truncated,
              } as const),
      }),
    }
  }

  private jobOf(incident: InspectedIncidentView, view: InspectView): IncidentJob | undefined {
    if (incident.jobId !== undefined) {
      return { id: incident.jobId }
    }
    if (incident.externalTaskId === undefined) {
      return undefined
    }
    const waiting = view.waitingAt.find(
      (wait) => wait.incidentId === incident.id && wait.kind === "externalTask",
    )
    return { id: incident.externalTaskId, ...Present.fields({ type: waiting?.topic }) }
  }

  private calledInstanceOf(child: ChildInstanceView, view: InspectView): CalledInstance {
    const call = view.calls.find((candidate) => candidate.calledProcessInstanceId === child.id)
    return {
      id: InstanceId(child.id),
      parentInstanceId: InstanceId(child.parentId),
      bpmnProcessId: BpmnProcessId(child.key),
      state: InstanceStates.of(child.state),
      ...Present.fields({
        calledFromElementId: call === undefined ? undefined : ElementId(call.activityId),
      }),
    }
  }

  private variablesOf(
    instance: InstanceSummary,
    view: InspectView,
    typedVariables: readonly VariableView[] | undefined,
  ): Variable[] {
    const views =
      instance.state === "running" && typedVariables !== undefined ? typedVariables : view.variables
    return views
      .map((variable) => this.variableOf(variable))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  private variableOf(view: VariableView): Variable {
    const embedded: unknown = view.type === "Json" ? JSON.parse(view.valueJson) : undefined
    return {
      name: view.name,
      scope:
        view.scopeElementId === undefined
          ? { kind: "instance" }
          : { kind: "element", elementId: ElementId(view.scopeElementId) },
      valueJson: typeof embedded === "string" ? embedded : view.valueJson,
      truncated: false,
      kind:
        view.type === undefined
          ? ValueKinds.ofJson(view.valueJson)
          : (KIND_OF_TYPE.get(view.type) ?? "opaque"),
      ...Present.fields({ type: view.type }),
    }
  }
}
