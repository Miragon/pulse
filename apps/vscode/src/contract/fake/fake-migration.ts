import type { BulkFailure } from "../model/bulk-operations.js"
import type { DefinitionId, ElementId, InstanceId } from "../model/ids.js"
import type {
  ElementMapping,
  MigrationCheck,
  MigrationPlan,
  MigrationProblem,
} from "../model/migrations.js"
import type { DefinitionRef } from "../model/read-models.js"
import { RuntimeError } from "../model/runtime-error.js"
import { FakeDiagramElements } from "./fake-diagram-elements.js"
import type { FakeDefinition, FakeEngineState, FakeInstance } from "./fake-engine-state.js"
import { FakeQueries } from "./fake-queries.js"
import { FakeTransitions } from "./fake-transitions.js"

interface PlanKinds {
  readonly source: ReadonlyMap<ElementId, string>
  readonly target: ReadonlyMap<ElementId, string>
}

export interface FakeMigrationWork {
  readonly state: FakeEngineState
  readonly migrated: number
  readonly failures: readonly BulkFailure[]
}

export class FakeMigration {
  constructor(private readonly state: FakeEngineState) {}

  proposal(source: DefinitionId, target: DefinitionId): MigrationPlan {
    const sourceKinds = FakeDiagramElements.kindsOf(this.definition(source).xml)
    const targetKinds = FakeDiagramElements.kindsOf(this.definition(target).xml)
    const mappings = [...sourceKinds]
      .filter(([id, kind]) => FakeDiagramElements.holdsTokens(kind) && targetKinds.get(id) === kind)
      .map(([id]) => ({ sourceElementId: id, targetElementId: id }))
    return { sourceDefinitionId: source, targetDefinitionId: target, mappings }
  }

  check(plan: MigrationPlan): MigrationCheck {
    const kinds: PlanKinds = {
      source: FakeDiagramElements.kindsOf(this.definition(plan.sourceDefinitionId).xml),
      target: FakeDiagramElements.kindsOf(this.definition(plan.targetDefinitionId).xml),
    }
    const problems = plan.mappings.flatMap((mapping, index): MigrationProblem[] => {
      const message = this.problemOf(mapping, kinds, plan.mappings.slice(0, index))
      return message === undefined ? [] : [{ mapping, message }]
    })
    return { problems }
  }

  runningOnSource(plan: MigrationPlan, instanceIds: readonly InstanceId[]): InstanceId[] {
    this.definition(plan.targetDefinitionId)
    return new FakeQueries(this.state)
      .instances({ definitionId: plan.sourceDefinitionId, lifecycle: "running", instanceIds })
      .map((instance) => instance.id)
  }

  worked(plan: MigrationPlan, instanceIds: readonly InstanceId[]): FakeMigrationWork {
    const target = this.definition(plan.targetDefinitionId).ref
    const targets = new Map(plan.mappings.map((m) => [m.sourceElementId, m.targetElementId]))
    const movable = new Set<InstanceId>()
    const failures: BulkFailure[] = []
    for (const instanceId of instanceIds) {
      const reason = this.whyNot(instanceId, plan, targets)
      if (reason === undefined) {
        movable.add(instanceId)
      } else {
        failures.push({ instanceId, reason })
      }
    }
    const state = new FakeTransitions({
      ...this.state,
      instances: this.state.instances.map((instance) =>
        movable.has(instance.summary.id) ? this.migrated(instance, target, targets) : instance,
      ),
      incidents: this.state.incidents.map((entry) =>
        movable.has(entry.incident.instanceId)
          ? {
              ...entry,
              incident: {
                ...entry.incident,
                definition: target,
                elementId: targets.get(entry.incident.elementId) ?? entry.incident.elementId,
              },
            }
          : entry,
      ),
    }).withIncidentFlags()
    return { state, migrated: movable.size, failures }
  }

  private definition(id: DefinitionId): FakeDefinition {
    const definition = this.state.definitions.find((candidate) => candidate.ref.id === id)
    if (definition === undefined) {
      throw new RuntimeError("rejected", `Process definition ${id} does not exist.`)
    }
    return definition
  }

  private problemOf(
    mapping: ElementMapping,
    kinds: PlanKinds,
    earlier: readonly ElementMapping[],
  ): string | undefined {
    const sourceKind = kinds.source.get(mapping.sourceElementId)
    const targetKind = kinds.target.get(mapping.targetElementId)
    if (sourceKind === undefined) {
      return `Source element ${mapping.sourceElementId} does not exist.`
    }
    if (targetKind === undefined) {
      return `Target element ${mapping.targetElementId} does not exist.`
    }
    if (earlier.some((other) => other.sourceElementId === mapping.sourceElementId)) {
      return `${mapping.sourceElementId} is mapped twice.`
    }
    return sourceKind === targetKind ? undefined : `A ${sourceKind} cannot become a ${targetKind}.`
  }

  private whyNot(
    instanceId: InstanceId,
    plan: MigrationPlan,
    targets: ReadonlyMap<ElementId, ElementId>,
  ): string | undefined {
    const instance = this.state.instances.find((candidate) => candidate.summary.id === instanceId)
    if (
      instance === undefined ||
      !FakeQueries.isRunning(instance.summary) ||
      instance.summary.definition.id !== plan.sourceDefinitionId
    ) {
      return `Instance ${instanceId} does not run on ${plan.sourceDefinitionId}.`
    }
    const unmapped = instance.activeElementIds.find((elementId) => !targets.has(elementId))
    return unmapped === undefined ? undefined : `No mapping for the token at ${unmapped}.`
  }

  private migrated(
    instance: FakeInstance,
    target: DefinitionRef,
    targets: ReadonlyMap<ElementId, ElementId>,
  ): FakeInstance {
    const mapped = (elementId: ElementId): ElementId => targets.get(elementId) ?? elementId
    return {
      ...instance,
      summary: { ...instance.summary, definition: target },
      activeElementIds: instance.activeElementIds.map(mapped),
      waitStates: instance.waitStates.map((waitState) => ({
        ...waitState,
        elementId: mapped(waitState.elementId),
      })),
    }
  }
}
