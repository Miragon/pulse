import {
  NEUTRAL_DIAGRAMS,
  WORLD_CALL,
  WORLD_DEPLOYMENTS,
  WORLD_ELEMENT,
  WORLD_LOCAL_VARIABLE,
  WORLD_PROCESS,
  WORLD_SECOND_TOKEN,
  type BulkInstanceAlias,
  type CommandInstanceAlias,
  type DeploymentAlias,
  type InstanceAlias,
  type MigrationInstanceAlias,
  type WorldInstance,
} from '../conformance/world/world.js';
import {
  BpmnProcessId,
  DefinitionId,
  ElementId,
  IncidentId,
  InstanceId,
  IsoTimestamp,
} from '../model/ids.js';
import type { DefinitionRef, ElementRun, InstanceSummary, Variable } from '../model/read-models.js';
import type { FakeDefinition, FakeIncident, FakeInstance } from './fake-engine-state.js';

const STARTED_AT = IsoTimestamp('2026-10-21T08:00:00Z');
const ENDED_AT = IsoTimestamp('2026-10-21T08:00:01Z');
const FAILED_AT = IsoTimestamp('2026-10-21T08:00:02Z');
const DISPATCH_REQUESTED = 'Event_DispatchRequested';
const LABEL_REQUESTED = 'Event_LabelRequested';
const PROCESS_NAMES = {
  order: 'Order fulfillment',
  dispatch: 'Dispatch order',
  label: 'Print label',
} as const;

const STACKTRACE = [
  'org.example.TaskFailure: Cannot resolve identifier',
  '\tat org.example.Worker.execute(Worker.java:42)',
  'Caused by: org.example.MissingBean: Cannot resolve identifier',
].join('\n');

const LOCAL_VARIABLE: Variable = {
  name: WORLD_LOCAL_VARIABLE.name,
  scope: { kind: 'element', elementId: ElementId(WORLD_LOCAL_VARIABLE.elementId) },
  valueJson: JSON.stringify(WORLD_LOCAL_VARIABLE.value),
  truncated: false,
  type: 'String',
  kind: 'string',
};

export type AnyWorldInstance = WorldInstance<
  InstanceAlias | CommandInstanceAlias | BulkInstanceAlias | MigrationInstanceAlias
>;

export interface Simulated {
  readonly instances: FakeInstance[];
  readonly incidents: FakeIncident[];
}

export class FakeWorldSimulation {
  static definitionOf(alias: DeploymentAlias): FakeDefinition {
    const deployment = WORLD_DEPLOYMENTS.find((candidate) => candidate.alias === alias);
    if (deployment === undefined) {
      throw new RangeError(`unknown deployment ${alias}`);
    }
    const bpmnProcessId = WORLD_PROCESS[deployment.process];
    return {
      ref: {
        id: DefinitionId(`${bpmnProcessId}:${deployment.version}`),
        bpmnProcessId: BpmnProcessId(bpmnProcessId),
        version: deployment.version,
        name: PROCESS_NAMES[deployment.process],
      },
      xml: NEUTRAL_DIAGRAMS[deployment.process],
      calls:
        deployment.process === WORLD_CALL.caller
          ? [
              {
                elementId: ElementId(WORLD_CALL.elementId),
                bpmnProcessId: BpmnProcessId(WORLD_PROCESS[WORLD_CALL.called]),
              },
            ]
          : [],
    };
  }

  simulate(world: AnyWorldInstance): Simulated {
    const definition = FakeWorldSimulation.definitionOf(world.deployment).ref;
    return world.deployment === 'dispatch@1'
      ? this.simulateDispatch(world, definition)
      : this.simulateOrder(world, definition);
  }

  private variablesOf(values: WorldInstance['variables']): Variable[] {
    return Object.entries(values).map(([name, value]) => ({
      name,
      scope: { kind: 'instance' },
      valueJson: JSON.stringify(value),
      truncated: false,
      type: typeof value === 'number' ? 'Integer' : 'String',
      kind: typeof value === 'number' ? 'integer' : 'string',
    }));
  }

  private pathOf(ended: readonly string[], open?: string): ElementRun[] {
    const done = ended.map((elementId) => ({
      elementId: ElementId(elementId),
      startedAt: STARTED_AT,
      endedAt: ENDED_AT,
      canceled: false,
    }));
    return open === undefined
      ? done
      : [...done, { elementId: ElementId(open), startedAt: ENDED_AT, canceled: false }];
  }

  private summaryOf(
    world: AnyWorldInstance,
    definition: DefinitionRef,
    extra: Partial<InstanceSummary>,
  ): InstanceSummary {
    return {
      id: InstanceId(`fake-${world.businessKey}`),
      definition,
      state: 'running',
      hasIncident: false,
      businessKey: world.businessKey,
      startedAt: STARTED_AT,
      ...extra,
    };
  }

  private failure(
    instanceId: InstanceId,
    definition: DefinitionRef,
    elementId: string,
  ): FakeIncident {
    return {
      incident: {
        id: IncidentId(`incident-of-${instanceId}`),
        instanceId,
        definition,
        elementId: ElementId(elementId),
        type: 'failedTask',
        message: 'Cannot resolve identifier',
        createdAt: FAILED_AT,
        retriesLeft: 0,
        job: { id: `job-of-${instanceId}` },
      },
      fullDetails: { kind: 'stacktrace', text: STACKTRACE, truncated: false },
    };
  }

  private simulateExpressOrder(
    world: AnyWorldInstance,
    definition: DefinitionRef,
    variables: readonly Variable[],
  ): Simulated {
    const summary = this.summaryOf(world, definition, { state: 'completed', endedAt: ENDED_AT });
    return {
      instances: [
        {
          summary,
          activeElementIds: [],
          waitStates: [],
          variables,
          path: this.pathOf([
            WORLD_ELEMENT.orderReceived,
            WORLD_ELEMENT.route,
            WORLD_ELEMENT.shippedExpress,
          ]),
        },
      ],
      incidents: [],
    };
  }

  private simulateOrder(world: AnyWorldInstance, definition: DefinitionRef): Simulated {
    const variables = this.variablesOf(world.variables);
    if (world.variables.route === 'express') {
      return this.simulateExpressOrder(world, definition, variables);
    }
    if (world.variables.route === 'charge') {
      const summary = this.summaryOf(world, definition, { hasIncident: true });
      const incident = this.failure(summary.id, definition, WORLD_ELEMENT.chargePayment);
      const elementId = ElementId(WORLD_ELEMENT.chargePayment);
      const waitStates = [
        {
          kind: 'asyncContinuation',
          instanceId: summary.id,
          elementId,
          retriesLeft: 0,
          incidentId: incident.incident.id,
        },
      ] as const;
      return {
        instances: [
          {
            summary,
            activeElementIds: [elementId],
            waitStates,
            variables,
            path: this.pathOf([WORLD_ELEMENT.orderReceived, WORLD_ELEMENT.route], elementId),
          },
        ],
        incidents: [incident],
      };
    }
    const summary = this.summaryOf(world, definition, {});
    const elementId = ElementId(WORLD_ELEMENT.reviewOrder);
    const tokens = world.businessKey === WORLD_SECOND_TOKEN.instance ? 2 : 1;
    const wait = { kind: 'userTask', instanceId: summary.id, elementId, assignee: 'demo' } as const;
    const path = this.pathOf([WORLD_ELEMENT.orderReceived, WORLD_ELEMENT.route], elementId);
    const local = world.businessKey === WORLD_LOCAL_VARIABLE.instance ? [LOCAL_VARIABLE] : [];
    return {
      instances: [
        {
          summary,
          activeElementIds: Array.from({ length: tokens }, () => elementId),
          waitStates: Array.from({ length: tokens }, () => wait),
          variables: [...variables, ...local],
          path: tokens === 1 ? path : [...path, ...path.slice(-1)],
        },
      ],
      incidents: [],
    };
  }

  private simulateDispatch(world: AnyWorldInstance, definition: DefinitionRef): Simulated {
    const parent = this.summaryOf(world, definition, { hasIncident: true });
    const label = FakeWorldSimulation.definitionOf('label@1').ref;
    const child: InstanceSummary = {
      id: InstanceId(`fake-label-of-${world.businessKey}`),
      definition: label,
      state: 'running',
      hasIncident: true,
      startedAt: STARTED_AT,
      parentInstanceId: parent.id,
    };
    const incident = this.failure(child.id, label, WORLD_ELEMENT.renderLabel);
    const callActivity = ElementId(WORLD_ELEMENT.printShippingLabel);
    const renderLabel = ElementId(WORLD_ELEMENT.renderLabel);
    return {
      instances: [
        {
          summary: parent,
          activeElementIds: [callActivity],
          waitStates: [],
          variables: this.variablesOf(world.variables),
          path: this.pathOf([DISPATCH_REQUESTED], callActivity),
        },
        {
          summary: child,
          activeElementIds: [renderLabel],
          waitStates: [
            {
              kind: 'asyncContinuation',
              instanceId: child.id,
              elementId: renderLabel,
              retriesLeft: 0,
              incidentId: incident.incident.id,
            },
          ],
          variables: this.variablesOf(world.variables),
          path: this.pathOf([LABEL_REQUESTED], renderLabel),
          calledFromElementId: callActivity,
        },
      ],
      incidents: [incident],
    };
  }
}
