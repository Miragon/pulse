import { BpmnProcessId, ElementId } from '../../model/ids.js';
import type { InstanceDetail } from '../../model/read-models.js';
import { Ensure } from '../ensure.js';
import { CASE, type ConformanceCase } from '../conformance-case.js';
import type { ConformanceHarness } from '../harness.js';
import {
  WORLD_ELEMENT,
  WORLD_LOCAL_VARIABLE,
  WORLD_PROCESS,
  type InstanceAlias,
} from '../world/world.js';

class DetailReads {
  static describePath(detail: InstanceDetail): string {
    return Ensure.describe(
      detail.path.map((run) => [run.elementId, run.endedAt === undefined ? 'open' : 'ended']),
    );
  }

  static pathIds(detail: InstanceDetail): string {
    return detail.path.map((run) => run.elementId).join(' > ');
  }

  static inStartOrder(detail: InstanceDetail): boolean {
    return detail.path.every(
      (run, index) => index === 0 || (detail.path[index - 1]?.startedAt ?? '') <= run.startedAt,
    );
  }

  static async detailOf(
    harness: ConformanceHarness,
    alias: InstanceAlias,
    law: string,
  ): Promise<InstanceDetail> {
    const detail = await harness.runtime.getInstanceDetail(harness.world.instanceIds[alias]);
    return Ensure.defined(detail, law, `no detail for ${alias}`);
  }
}

const detailUnknown: ConformanceCase = {
  name: CASE.detailUnknown,
  async run(harness) {
    const detail = await harness.runtime.getInstanceDetail(harness.world.unknown.instanceId);
    Ensure.that(detail === undefined, this.name, 'an unknown instance must be undefined');
  },
};

const detailUserTask: ConformanceCase = {
  name: CASE.detailUserTask,
  async run(harness) {
    const detail = await DetailReads.detailOf(harness, 'ORD-1001', this.name);
    Ensure.that(
      detail.instance.state === 'running',
      this.name,
      `state is ${detail.instance.state}`,
    );
    const waiting = detail.waitStates.find(
      (waitState) => waitState.elementId === ElementId(WORLD_ELEMENT.reviewOrder),
    );
    Ensure.that(
      waiting?.kind === 'userTask',
      this.name,
      `wait states ${Ensure.describe(detail.waitStates)}`,
    );
    const route = detail.variables.find((variable) => variable.name === 'route');
    Ensure.that(
      route?.valueJson === '"review"' && route.scope.kind === 'instance',
      this.name,
      `route variable ${Ensure.describe(route)}`,
    );
  },
};

const detailIncident: ConformanceCase = {
  name: CASE.detailIncident,
  async run(harness) {
    const detail = await DetailReads.detailOf(harness, 'ORD-1002', this.name);
    Ensure.that(
      detail.incidents.length === 1,
      this.name,
      `incidents ${Ensure.describe(detail.incidents)}`,
    );
    const incident = Ensure.defined(detail.incidents[0], this.name, 'no incident');
    Ensure.that(
      incident.elementId === ElementId(WORLD_ELEMENT.chargePayment),
      this.name,
      `incident at ${incident.elementId}`,
    );
    Ensure.that(
      incident.instanceId === harness.world.instanceIds['ORD-1002'],
      this.name,
      `incident in ${incident.instanceId}`,
    );
    Ensure.that(incident.message.trim() !== '', this.name, 'the incident message is blank');
    Ensure.that(
      detail.instance.hasIncident,
      this.name,
      'the instance summary does not flag the incident',
    );
  },
};

const detailCalledInstance: ConformanceCase = {
  name: CASE.detailCalledInstance,
  async run(harness) {
    const parentId = harness.world.instanceIds['DSP-3001'];
    const detail = await DetailReads.detailOf(harness, 'DSP-3001', this.name);
    Ensure.that(
      detail.calledInstances.length === 1,
      this.name,
      `called ${Ensure.describe(detail.calledInstances)}`,
    );
    const called = Ensure.defined(detail.calledInstances[0], this.name, 'no called instance');
    Ensure.that(
      called.bpmnProcessId === BpmnProcessId(WORLD_PROCESS.label) &&
        called.parentInstanceId === parentId,
      this.name,
      `called instance ${Ensure.describe(called)}`,
    );
    Ensure.that(
      called.calledFromElementId === undefined ||
        called.calledFromElementId === ElementId(WORLD_ELEMENT.printShippingLabel),
      this.name,
      `called from ${String(called.calledFromElementId)}`,
    );
    Ensure.that(
      detail.incidents.length === 1,
      this.name,
      `incidents ${Ensure.describe(detail.incidents)}`,
    );
    const incident = Ensure.defined(detail.incidents[0], this.name, 'no incident');
    Ensure.that(
      incident.instanceId === called.id &&
        incident.elementId === ElementId(WORLD_ELEMENT.renderLabel),
      this.name,
      `incident ${Ensure.describe(incident)}`,
    );
  },
};

const detailWaitsAcrossCalledInstances: ConformanceCase = {
  name: CASE.detailWaitsAcrossCalledInstances,
  async run(harness) {
    const detail = await DetailReads.detailOf(harness, 'DSP-3001', this.name);
    const called = Ensure.defined(detail.calledInstances[0], this.name, 'no called instance');
    const childWait = detail.waitStates.find(
      (waitState) => waitState.elementId === ElementId(WORLD_ELEMENT.renderLabel),
    );
    Ensure.that(
      childWait?.instanceId === called.id,
      this.name,
      `wait states ${Ensure.describe(detail.waitStates)}`,
    );
    const ownWaits = await DetailReads.detailOf(harness, 'ORD-1001', this.name);
    Ensure.that(
      ownWaits.waitStates.every(
        (waitState) => waitState.instanceId === harness.world.instanceIds['ORD-1001'],
      ),
      this.name,
      'a wait state of an instance without children belongs to that instance',
    );
  },
};

const detailEnded: ConformanceCase = {
  name: CASE.detailEnded,
  async run(harness) {
    const detail = await DetailReads.detailOf(harness, 'ORD-1003', this.name);
    Ensure.that(
      detail.instance.state === 'completed',
      this.name,
      `state is ${detail.instance.state}`,
    );
    Ensure.that(detail.waitStates.length === 0, this.name, 'an ended instance waits nowhere');
    Ensure.that(detail.incidents.length === 0, this.name, 'an ended instance has no incidents');
  },
};

const detailPath: ConformanceCase = {
  name: CASE.detailPath,
  async run(harness) {
    const waiting = await DetailReads.detailOf(harness, 'ORD-1001', this.name);
    const expectedWaiting = [
      WORLD_ELEMENT.orderReceived,
      WORLD_ELEMENT.route,
      WORLD_ELEMENT.reviewOrder,
    ];
    Ensure.that(
      DetailReads.pathIds(waiting) === expectedWaiting.join(' > ') &&
        DetailReads.inStartOrder(waiting),
      this.name,
      `path ${DetailReads.describePath(waiting)}`,
    );
    Ensure.that(
      waiting.path.map((run) => run.endedAt === undefined).join() === 'false,false,true' &&
        waiting.path.every((run) => !run.canceled),
      this.name,
      `only the user task is open: ${DetailReads.describePath(waiting)}`,
    );
    const ended = await DetailReads.detailOf(harness, 'ORD-1003', this.name);
    const expectedEnded = [
      WORLD_ELEMENT.orderReceived,
      WORLD_ELEMENT.route,
      WORLD_ELEMENT.shippedExpress,
    ];
    Ensure.that(
      DetailReads.pathIds(ended) === expectedEnded.join(' > ') &&
        ended.path.every((run) => run.endedAt !== undefined && run.endedAt >= run.startedAt),
      this.name,
      `ended path ${DetailReads.describePath(ended)}`,
    );
  },
};

const detailVariableKinds: ConformanceCase = {
  name: CASE.detailVariableKinds,
  async run(harness) {
    const detail = await DetailReads.detailOf(harness, 'ORD-1002', this.name);
    const kinds = Object.fromEntries(
      detail.variables.map((variable) => [variable.name, variable.kind]),
    );
    Ensure.that(
      kinds.route === 'string' && kinds.amount === 'integer',
      this.name,
      `kinds ${Ensure.describe(kinds)}`,
    );
  },
};

const detailElementScope: ConformanceCase = {
  name: CASE.detailElementScope,
  async run(harness) {
    const detail = await DetailReads.detailOf(harness, WORLD_LOCAL_VARIABLE.instance, this.name);
    const local = detail.variables.find((variable) => variable.name === WORLD_LOCAL_VARIABLE.name);
    Ensure.that(
      local?.scope.kind === 'element' &&
        local.scope.elementId === ElementId(WORLD_LOCAL_VARIABLE.elementId) &&
        local.valueJson === JSON.stringify(WORLD_LOCAL_VARIABLE.value),
      this.name,
      `local variable ${Ensure.describe(local)}`,
    );
    const route = detail.variables.find((variable) => variable.name === 'route');
    Ensure.that(route?.scope.kind === 'instance', this.name, `route ${Ensure.describe(route)}`);
  },
};

export const DETAIL_LAWS: readonly ConformanceCase[] = [
  detailUnknown,
  detailUserTask,
  detailIncident,
  detailCalledInstance,
  detailWaitsAcrossCalledInstances,
  detailPath,
  detailEnded,
  detailVariableKinds,
  detailElementScope,
];
