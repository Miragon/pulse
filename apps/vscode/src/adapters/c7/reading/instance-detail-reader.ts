import type {
  CalledInstance,
  DefinitionRef,
  ElementRun,
  Incident,
  InstanceDetail,
  InstanceId,
  InstanceSummary,
  Variable,
  WaitState,
} from "../../../contract/index.js"
import { ErrorTranslation } from "../errors/error-translation.js"
import type { CalledFacts } from "../mapping/called-instance-mapper.js"
import type { DefinitionsByInstance, IncidentFacts } from "../mapping/incident-mapper.js"
import type { Mapper } from "../mapping/mapper.js"
import type { WaitFacts } from "../mapping/wait-state-mapper.js"
import {
  VARIABLE_PAGE_SIZE,
  type DefinitionView,
  type HistoricInstanceView,
  type InspectView,
  type EngineClient,
  type TimelineEntryView,
  type VariableView,
} from "../engine-cli/index.js"

export interface DetailMappers {
  readonly summaries: Mapper<InspectView, InstanceSummary>
  readonly waits: Mapper<WaitFacts, WaitState>
  readonly incidents: Mapper<IncidentFacts, Incident | undefined>
  readonly called: Mapper<CalledFacts, CalledInstance>
  readonly variables: Mapper<VariableView, Variable>
  readonly runs: Mapper<TimelineEntryView, ElementRun>
  readonly refs: Mapper<DefinitionView, DefinitionRef>
  readonly historicRefs: Mapper<HistoricInstanceView, DefinitionRef>
}

export class InstanceDetailReader {
  constructor(
    private readonly client: EngineClient,
    private readonly mappers: DetailMappers,
  ) {}

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
    const definitions = new Map([[view.id, this.mappers.refs.map(view.definition)]])
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
        definitions.set(row.id, this.mappers.historicRefs.map(row))
      }
    }
    return definitions
  }

  private detailOf(
    view: InspectView,
    definitions: DefinitionsByInstance,
    typedVariables: readonly VariableView[] | undefined,
  ): InstanceDetail {
    const waitStates = view.waitingAt.map((wait) =>
      this.mappers.waits.map({ wait, inspectedInstanceId: view.id }),
    )
    const instance = this.mappers.summaries.map(view)
    return {
      instance,
      path: view.timeline.map((entry) => this.mappers.runs.map(entry)),
      waitStates,
      incidents: view.incidents.flatMap(
        (incident) => this.mappers.incidents.map({ incident, view, definitions, waitStates }) ?? [],
      ),
      calledInstances: view.children.map((child) =>
        this.mappers.called.map({ child, calls: view.calls }),
      ),
      variables: this.variablesOf(instance, view, typedVariables),
      truncated: view.truncated || (typedVariables?.length ?? 0) >= VARIABLE_PAGE_SIZE,
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
      .map((variable) => this.mappers.variables.map(variable))
      .sort((left, right) => left.name.localeCompare(right.name))
  }
}
