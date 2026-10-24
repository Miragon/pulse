import { IsoTimestamp, type IncidentId, type InstanceId } from '../model/ids.js';
import type { Variable, WaitState } from '../model/read-models.js';
import { RuntimeError } from '../model/runtime-error.js';
import { ValueKinds } from '../model/value-kinds.js';
import type { VariableChange } from '../ports/process-commands.js';
import type { FakeEngineState, FakeInstance } from './fake-engine-state.js';
import { FakeQueries } from './fake-queries.js';

const CANCELLED_AT = IsoTimestamp('2026-10-21T09:00:00Z');

export class FakeTransitions {
  constructor(private readonly state: FakeEngineState) {}

  retried(incidentId: IncidentId): FakeEngineState {
    if (!this.state.incidents.some(({ incident }) => incident.id === incidentId)) {
      throw new RuntimeError('rejected', `Incident ${incidentId} is not open.`);
    }
    return new FakeTransitions({
      ...this.state,
      incidents: this.state.incidents.filter(({ incident }) => incident.id !== incidentId),
      instances: this.state.instances.map((instance) => ({
        ...instance,
        waitStates: instance.waitStates.map((waitState) =>
          this.waitingAgain(waitState, incidentId),
        ),
      })),
    }).withIncidentFlags();
  }

  withVariable(instanceId: InstanceId, change: VariableChange): FakeEngineState {
    const target = this.state.instances.find((instance) => instance.summary.id === instanceId);
    if (target === undefined || !FakeQueries.isRunning(target.summary)) {
      throw new RuntimeError('rejected', `Instance ${instanceId} is not running.`);
    }
    return {
      ...this.state,
      instances: this.state.instances.map((instance) =>
        instance === target
          ? { ...instance, variables: this.changedVariables(instance.variables, change) }
          : instance,
      ),
    };
  }

  cancelled(instanceIds: readonly InstanceId[]): FakeEngineState {
    const queries = new FakeQueries(this.state);
    const tree = new Set(
      this.state.instances
        .filter(
          (instance) =>
            instanceIds.includes(instance.summary.id) && FakeQueries.isRunning(instance.summary),
        )
        .flatMap((instance) => [instance, ...queries.descendantsOf(instance.summary.id)])
        .map((instance) => instance.summary.id),
    );
    return new FakeTransitions({
      ...this.state,
      incidents: this.state.incidents.filter(({ incident }) => !tree.has(incident.instanceId)),
      instances: this.state.instances.map((instance) =>
        tree.has(instance.summary.id) ? this.terminated(instance) : instance,
      ),
    }).withIncidentFlags();
  }

  withIncidentFlags(): FakeEngineState {
    return {
      ...this.state,
      instances: this.state.instances.map((instance) => ({
        ...instance,
        summary: { ...instance.summary, hasIncident: this.hasIncidentInTree(instance) },
      })),
    };
  }

  private terminated(instance: FakeInstance): FakeInstance {
    return {
      ...instance,
      summary: { ...instance.summary, state: 'terminated', endedAt: CANCELLED_AT },
      activeElementIds: [],
      waitStates: [],
      ...(instance.path === undefined
        ? {}
        : {
            path: instance.path.map((run) =>
              run.endedAt === undefined ? { ...run, endedAt: CANCELLED_AT, canceled: true } : run,
            ),
          }),
    };
  }

  private hasIncidentInTree(instance: FakeInstance): boolean {
    const descendants = new FakeQueries(this.state).descendantsOf(instance.summary.id);
    const tree = new Set([instance.summary.id, ...descendants.map((child) => child.summary.id)]);
    return this.state.incidents.some(({ incident }) => tree.has(incident.instanceId));
  }

  private waitingAgain(waitState: WaitState, incidentId: IncidentId): WaitState {
    if (waitState.incidentId !== incidentId) {
      return waitState;
    }
    const open = { ...waitState };
    delete open.incidentId;
    return open.kind === 'workerTask' || open.kind === 'asyncContinuation'
      ? { ...open, retriesLeft: 1 }
      : open;
  }

  private changedVariables(
    variables: readonly Variable[],
    change: VariableChange,
  ): readonly Variable[] {
    const changed: Variable = {
      name: change.name,
      scope: { kind: 'instance' },
      valueJson: change.valueJson.trim(),
      truncated: false,
      kind: ValueKinds.ofJson(change.valueJson),
      ...(change.type === undefined ? {} : { type: change.type }),
    };
    const others = variables.filter(
      (variable) => variable.name !== change.name || variable.scope.kind !== 'instance',
    );
    return [...others, changed];
  }
}
