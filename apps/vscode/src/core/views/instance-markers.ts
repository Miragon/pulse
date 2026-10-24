import type {
  CalledInstance,
  ElementId,
  InstanceDetail,
  InstanceId,
} from '../../contract/index.js';
import type { BpmnStructure } from '../bpmn/bpmn-structure.js';
import type { ElementMarker, MarkerKind } from '../protocol/index.js';
import { SubProcessRollUp } from './sub-process-roll-up.js';

const PRECEDENCE: Readonly<Record<MarkerKind, number>> = {
  incident: 3,
  incidentInCalledInstance: 2,
  waiting: 1,
  completed: 0,
  taken: 0,
};

export class InstanceMarkers {
  constructor(
    private readonly detail: InstanceDetail,
    private readonly structure: BpmnStructure,
  ) {}

  markers(): ElementMarker[] {
    const located = [
      ...this.incidentMarkers(),
      ...this.waitingMarkers(),
      ...this.completedMarkers(),
    ];
    return [
      ...this.strongest(SubProcessRollUp.markers(located, this.structure)),
      ...this.takenMarkers(),
    ];
  }

  private completedMarkers(): ElementMarker[] {
    return this.detail.path
      .filter((run) => run.endedAt !== undefined)
      .map((run) => ({ elementId: run.elementId, kind: 'completed' }));
  }

  private takenMarkers(): ElementMarker[] {
    const ended = new Set<string>(
      this.detail.path.filter((run) => run.endedAt !== undefined).map((run) => run.elementId),
    );
    const reached = new Set<string>([
      ...this.detail.path.map((run) => run.elementId),
      ...this.detail.waitStates
        .filter((waitState) => this.isInRoot(waitState.instanceId))
        .map((waitState) => waitState.elementId),
    ]);
    return this.structure
      .flowsBetween(ended, reached)
      .filter((flowId) => this.structure.collapsedAround(flowId).length === 0)
      .map((flowId) => ({ elementId: flowId, kind: 'taken' }));
  }

  private incidentMarkers(): ElementMarker[] {
    return this.detail.incidents.flatMap((incident): ElementMarker[] => {
      const elementId = this.locate(incident.instanceId, incident.elementId);
      if (elementId === undefined) {
        return [];
      }
      const kind = this.isInRoot(incident.instanceId) ? 'incident' : 'incidentInCalledInstance';
      return [{ elementId, kind }];
    });
  }

  private waitingMarkers(): ElementMarker[] {
    return this.detail.waitStates.flatMap((waitState): ElementMarker[] => {
      const elementId = this.locate(waitState.instanceId, waitState.elementId);
      return elementId === undefined ? [] : [{ elementId, kind: 'waiting' }];
    });
  }

  private locate(instanceId: InstanceId, elementId: ElementId): ElementId | undefined {
    if (this.isInRoot(instanceId)) {
      return elementId;
    }
    return this.directChildOf(instanceId)?.calledFromElementId;
  }

  private directChildOf(instanceId: InstanceId): CalledInstance | undefined {
    const rootId = this.detail.instance.id;
    let current = this.detail.calledInstances.find((called) => called.id === instanceId);
    while (current !== undefined && current.parentInstanceId !== rootId) {
      const parentId = current.parentInstanceId;
      current = this.detail.calledInstances.find((called) => called.id === parentId);
    }
    return current;
  }

  private isInRoot(instanceId: InstanceId): boolean {
    return instanceId === this.detail.instance.id;
  }

  private strongest(markers: readonly ElementMarker[]): ElementMarker[] {
    const byElement = new Map<string, ElementMarker>();
    for (const marker of markers) {
      const existing = byElement.get(marker.elementId);
      if (existing === undefined || PRECEDENCE[marker.kind] > PRECEDENCE[existing.kind]) {
        byElement.set(marker.elementId, marker);
      }
    }
    return [...byElement.values()];
  }
}
