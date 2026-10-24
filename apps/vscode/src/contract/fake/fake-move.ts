import { IsoTimestamp, type ElementId, type InstanceId } from '../model/ids.js';
import { MoveReasons } from '../model/move-reasons.js';
import type { ElementRun, WaitState } from '../model/read-models.js';
import { RuntimeError } from '../model/runtime-error.js';
import type { TokenMove } from '../ports/process-commands.js';
import type { FakeEngineState, FakeInstance } from './fake-engine-state.js';
import { FakeQueries } from './fake-queries.js';
import { FakeTransitions } from './fake-transitions.js';

const MOVED_AT = IsoTimestamp('2026-10-21T09:00:00Z');

export class FakeMove {
  constructor(private readonly state: FakeEngineState) {}

  moved(instanceId: InstanceId, move: TokenMove): FakeEngineState {
    const target = this.state.instances.find((instance) => instance.summary.id === instanceId);
    if (target === undefined || !FakeQueries.isRunning(target.summary)) {
      throw new RuntimeError('rejected', `Instance ${instanceId} is not running.`);
    }
    const invalidReason = MoveReasons.whyInvalid(move.reason);
    if (invalidReason !== undefined) {
      throw new RuntimeError('rejected', invalidReason);
    }
    const tokens = target.activeElementIds.filter((elementId) => elementId === move.fromElementId);
    if (tokens.length !== 1) {
      throw new RuntimeError('rejected', `${tokens.length} tokens wait at ${move.fromElementId}.`);
    }
    const kind = this.kindOf(target, move.toElementId);
    return new FakeTransitions({
      ...this.state,
      instances: this.state.instances.map((instance) =>
        instance === target ? this.movedInstance(instance, move, kind) : instance,
      ),
      incidents: this.state.incidents.filter(
        ({ incident }) =>
          incident.instanceId !== instanceId || incident.elementId !== move.fromElementId,
      ),
    }).withIncidentFlags();
  }

  private kindOf(instance: FakeInstance, elementId: ElementId): string {
    const xml = this.state.definitions.find(
      (definition) => definition.ref.id === instance.summary.definition.id,
    )?.xml;
    const kind = xml?.match(new RegExp(`<bpmn:(\\w+) id="${elementId}"`))?.[1];
    if (kind === undefined) {
      throw new RuntimeError('rejected', `The process has no element ${elementId}.`);
    }
    return kind;
  }

  private movedInstance(instance: FakeInstance, move: TokenMove, kind: string): FakeInstance {
    const ends = kind === 'endEvent';
    const others = instance.activeElementIds.filter((id) => id !== move.fromElementId);
    const activeElementIds = ends ? others : [...others, move.toElementId];
    const waitStates = instance.waitStates.filter(
      (waitState) =>
        waitState.elementId !== move.fromElementId &&
        waitState.attachedToElementId !== move.fromElementId,
    );
    const moved: FakeInstance = {
      ...instance,
      activeElementIds,
      waitStates: [...waitStates, ...this.waitAt(instance.summary.id, move.toElementId, kind)],
      path: [
        ...(instance.path ?? []).map((run) => this.canceledAt(run, move.fromElementId)),
        this.runOf(move.toElementId, ends),
      ],
    };
    return activeElementIds.length > 0
      ? moved
      : { ...moved, summary: { ...moved.summary, state: 'completed', endedAt: MOVED_AT } };
  }

  private waitAt(instanceId: InstanceId, elementId: ElementId, kind: string): WaitState[] {
    return kind === 'userTask' ? [{ kind: 'userTask', instanceId, elementId }] : [];
  }

  private canceledAt(run: ElementRun, elementId: ElementId): ElementRun {
    return run.elementId === elementId && run.endedAt === undefined
      ? { ...run, endedAt: MOVED_AT, canceled: true }
      : run;
  }

  private runOf(elementId: ElementId, ended: boolean): ElementRun {
    const run = { elementId, startedAt: MOVED_AT, canceled: false };
    return ended ? { ...run, endedAt: MOVED_AT } : run;
  }
}
