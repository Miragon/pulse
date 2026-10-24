import type { BpmnProcessId, DefinitionId, ElementId, InstanceId } from '../model/ids.js';
import { PageCursor } from '../model/ids.js';
import type { IncidentFilter, InstanceFilter, Page, PageRequest } from '../model/queries.js';
import type {
  DefinitionRef,
  ElementStatistics,
  Incident,
  InstanceSummary,
} from '../model/read-models.js';
import type { FakeEngineState, FakeInstance } from './fake-engine-state.js';

export class FakeQueries {
  constructor(private readonly state: FakeEngineState) {}

  static isRunning(instance: InstanceSummary): boolean {
    return instance.state === 'running' || instance.state === 'suspended';
  }

  static pageOf<Item>(items: readonly Item[], page: PageRequest): Page<Item> {
    const offset = page.after === undefined ? 0 : Number(page.after);
    const end = offset + page.limit;
    const slice = items.slice(offset, end);
    return end < items.length ? { items: slice, next: PageCursor(String(end)) } : { items: slice };
  }

  instances(filter: InstanceFilter): readonly InstanceSummary[] {
    return this.state.instances
      .filter((instance) => this.matchesInstance(instance, filter))
      .map((instance) => instance.summary)
      .sort((left, right) => (right.startedAt ?? '').localeCompare(left.startedAt ?? ''));
  }

  incidents(filter: IncidentFilter): readonly Incident[] {
    return this.state.incidents
      .map(({ incident }) => incident)
      .filter(
        (incident) =>
          this.matchesProcess(incident.definition, filter.bpmnProcessId, filter.definitionId) &&
          (filter.instanceId === undefined || incident.instanceId === filter.instanceId),
      );
  }

  descendantsOf(instanceId: InstanceId): FakeInstance[] {
    const children = this.state.instances.filter(
      (instance) => instance.summary.parentInstanceId === instanceId,
    );
    return children.flatMap((child) => [child, ...this.descendantsOf(child.summary.id)]);
  }

  elementStatistics(definitionId: DefinitionId): readonly ElementStatistics[] {
    const running = this.state.instances.filter(
      (instance) =>
        instance.summary.definition.id === definitionId && FakeQueries.isRunning(instance.summary),
    );
    const active = this.countBy(
      running.flatMap((instance) => this.activeWithoutIncident(instance)),
    );
    const incidents = this.countBy(
      this.incidents({ definitionId }).map((incident) => incident.elementId),
    );
    const called = this.countBy(this.calledFromWithIncident(running));
    const elementIds = new Set([...active.keys(), ...incidents.keys(), ...called.keys()]);
    return [...elementIds].map((elementId) => ({
      elementId,
      active: active.get(elementId) ?? 0,
      incidents: incidents.get(elementId) ?? 0,
      incidentsInCalledInstances: called.get(elementId) ?? 0,
    }));
  }

  private matchesProcess(
    ref: DefinitionRef,
    bpmnProcessId: BpmnProcessId | undefined,
    definitionId: DefinitionId | undefined,
  ): boolean {
    const processMatches = bpmnProcessId === undefined || ref.bpmnProcessId === bpmnProcessId;
    const definitionMatches = definitionId === undefined || ref.id === definitionId;
    return processMatches && definitionMatches;
  }

  private matchesLifecycle(summary: InstanceSummary, filter: InstanceFilter): boolean {
    if (filter.lifecycle === undefined) {
      return true;
    }
    return filter.lifecycle === 'running'
      ? FakeQueries.isRunning(summary)
      : !FakeQueries.isRunning(summary);
  }

  private matchesInstance(instance: FakeInstance, filter: InstanceFilter): boolean {
    const { summary } = instance;
    return (
      this.matchesProcess(summary.definition, filter.bpmnProcessId, filter.definitionId) &&
      this.matchesLifecycle(summary, filter) &&
      (filter.withIncident === undefined || summary.hasIncident === filter.withIncident) &&
      (filter.businessKey === undefined || summary.businessKey === filter.businessKey) &&
      (filter.activeElementId === undefined ||
        instance.activeElementIds.includes(filter.activeElementId)) &&
      this.matchesIds(summary, filter)
    );
  }

  private matchesIds(summary: InstanceSummary, filter: InstanceFilter): boolean {
    return filter.instanceIds === undefined || filter.instanceIds.includes(summary.id);
  }

  private countBy(elementIds: readonly ElementId[]): Map<ElementId, number> {
    const counts = new Map<ElementId, number>();
    for (const elementId of elementIds) {
      counts.set(elementId, (counts.get(elementId) ?? 0) + 1);
    }
    return counts;
  }

  private activeWithoutIncident(instance: FakeInstance): ElementId[] {
    const failing = new Set(
      this.state.incidents
        .filter(({ incident }) => incident.instanceId === instance.summary.id)
        .map(({ incident }) => incident.elementId),
    );
    return instance.activeElementIds.filter((elementId) => !failing.has(elementId));
  }

  private calledFromWithIncident(running: readonly FakeInstance[]): ElementId[] {
    return running.flatMap((parent) =>
      this.state.instances
        .filter((child) => child.summary.parentInstanceId === parent.summary.id)
        .flatMap((child) =>
          child.summary.hasIncident && child.calledFromElementId !== undefined
            ? [child.calledFromElementId]
            : [],
        ),
    );
  }
}
