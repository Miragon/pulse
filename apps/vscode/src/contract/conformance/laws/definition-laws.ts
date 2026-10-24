import { BpmnProcessId, ElementId } from '../../model/ids.js';
import type { DefinitionSummary, ElementStatistics } from '../../model/read-models.js';
import { Ensure } from '../ensure.js';
import { CASE, type ConformanceCase } from '../conformance-case.js';
import type { ConformanceHarness } from '../harness.js';
import { WORLD_ELEMENT, WORLD_PROCESS } from '../world/world.js';

class DefinitionReads {
  static async summaryOf(
    harness: ConformanceHarness,
    bpmnProcessId: string,
    law: string,
  ): Promise<DefinitionSummary> {
    const summaries = await harness.runtime.listDefinitions();
    const matching = summaries.filter((summary) => summary.latest.bpmnProcessId === bpmnProcessId);
    Ensure.that(
      matching.length === 1,
      law,
      `expected one summary of ${bpmnProcessId}, got ${matching.length}`,
    );
    return Ensure.defined(matching[0], law, `no summary of ${bpmnProcessId}`);
  }

  static statisticOf(
    statistics: readonly ElementStatistics[],
    elementId: string,
  ): Omit<ElementStatistics, 'elementId'> {
    const found = statistics.find((statistic) => statistic.elementId === ElementId(elementId));
    return found ?? { active: 0, incidents: 0, incidentsInCalledInstances: 0 };
  }
}

const definitionsLatestVersion: ConformanceCase = {
  name: CASE.definitionsLatestVersion,
  async run(harness) {
    const order = await DefinitionReads.summaryOf(harness, WORLD_PROCESS.order, this.name);
    Ensure.that(
      order.latest.version === 2,
      this.name,
      `order latest version is ${order.latest.version}`,
    );
    Ensure.that(
      order.latest.id === harness.world.definitionIds['order@2'],
      this.name,
      `order latest id is ${order.latest.id}`,
    );
    const label = await DefinitionReads.summaryOf(harness, WORLD_PROCESS.label, this.name);
    Ensure.that(
      label.latest.version === 1,
      this.name,
      `label latest version is ${label.latest.version}`,
    );
  },
};

const definitionsCounts: ConformanceCase = {
  name: CASE.definitionsCounts,
  async run(harness) {
    const expected = [
      { process: WORLD_PROCESS.order, running: 3, withIncident: 1 },
      { process: WORLD_PROCESS.dispatch, running: 1, withIncident: 1 },
      { process: WORLD_PROCESS.label, running: 1, withIncident: 1 },
    ];
    for (const { process, running, withIncident } of expected) {
      const summary = await DefinitionReads.summaryOf(harness, process, this.name);
      Ensure.that(
        summary.running === running && summary.withIncident === withIncident,
        this.name,
        `${process} expected running ${running}, withIncident ${withIncident}, got ${Ensure.describe({ running: summary.running, withIncident: summary.withIncident })}`,
      );
    }
  },
};

const versionsCounts: ConformanceCase = {
  name: CASE.versionsCounts,
  async run(harness) {
    const versions = await harness.runtime.listVersions(BpmnProcessId(WORLD_PROCESS.order));
    const actual = versions.map((version) => ({
      id: version.definition.id,
      version: version.definition.version,
      running: version.running,
      withIncident: version.withIncident,
    }));
    const expected = [
      { id: harness.world.definitionIds['order@2'], version: 2, running: 1, withIncident: 0 },
      { id: harness.world.definitionIds['order@1'], version: 1, running: 2, withIncident: 1 },
    ];
    Ensure.that(
      Ensure.describe(actual) === Ensure.describe(expected),
      this.name,
      `expected ${Ensure.describe(expected)}, got ${Ensure.describe(actual)}`,
    );
  },
};

const diagramOfVersion: ConformanceCase = {
  name: CASE.diagramOfVersion,
  async run(harness) {
    const xml = await harness.runtime.getDiagramXml(harness.world.definitionIds['order@1']);
    Ensure.that(
      xml?.includes(`id="${WORLD_ELEMENT.reviewOrder}"`) === true,
      this.name,
      'the order XML lacks the review task',
    );
    const unknown = await harness.runtime.getDiagramXml(harness.world.unknown.definitionId);
    Ensure.that(unknown === undefined, this.name, 'an unknown definition must be undefined');
  },
};

const statisticsPerVersion: ConformanceCase = {
  name: CASE.statisticsPerVersion,
  async run(harness) {
    const first = await harness.runtime.getElementStatistics(
      harness.world.definitionIds['order@1'],
    );
    const second = await harness.runtime.getElementStatistics(
      harness.world.definitionIds['order@2'],
    );
    const firstReview = DefinitionReads.statisticOf(first, WORLD_ELEMENT.reviewOrder);
    const firstCharge = DefinitionReads.statisticOf(first, WORLD_ELEMENT.chargePayment);
    const secondReview = DefinitionReads.statisticOf(second, WORLD_ELEMENT.reviewOrder);
    const secondCharge = DefinitionReads.statisticOf(second, WORLD_ELEMENT.chargePayment);
    Ensure.that(firstReview.active === 1, this.name, `v1 review active ${firstReview.active}`);
    Ensure.that(
      firstCharge.incidents === 1,
      this.name,
      `v1 charge incidents ${firstCharge.incidents}`,
    );
    Ensure.that(secondReview.active === 1, this.name, `v2 review active ${secondReview.active}`);
    Ensure.that(
      secondCharge.incidents === 0,
      this.name,
      `v2 charge incidents ${secondCharge.incidents}`,
    );
  },
};

const statisticsDisjoint: ConformanceCase = {
  name: CASE.statisticsDisjoint,
  async run(harness) {
    const statistics = await harness.runtime.getElementStatistics(
      harness.world.definitionIds['order@1'],
    );
    const charge = DefinitionReads.statisticOf(statistics, WORLD_ELEMENT.chargePayment);
    const review = DefinitionReads.statisticOf(statistics, WORLD_ELEMENT.reviewOrder);
    Ensure.that(
      charge.active === 0 && charge.incidents === 1,
      this.name,
      `failing task ${Ensure.describe(charge)}`,
    );
    Ensure.that(
      review.active === 1 && review.incidents === 0,
      this.name,
      `waiting task ${Ensure.describe(review)}`,
    );
  },
};

const statisticsCalledIncidents: ConformanceCase = {
  name: CASE.statisticsCalledIncidents,
  async run(harness) {
    const parent = await harness.runtime.getElementStatistics(
      harness.world.definitionIds['dispatch@1'],
    );
    const child = await harness.runtime.getElementStatistics(
      harness.world.definitionIds['label@1'],
    );
    const callActivity = DefinitionReads.statisticOf(parent, WORLD_ELEMENT.printShippingLabel);
    const failing = DefinitionReads.statisticOf(child, WORLD_ELEMENT.renderLabel);
    Ensure.that(
      callActivity.incidents === 0 && callActivity.incidentsInCalledInstances === 1,
      this.name,
      `call activity ${Ensure.describe(callActivity)}`,
    );
    Ensure.that(
      failing.incidents === 1 && failing.incidentsInCalledInstances === 0,
      this.name,
      `failing task ${Ensure.describe(failing)}`,
    );
  },
};

export const DEFINITION_LAWS: readonly ConformanceCase[] = [
  definitionsLatestVersion,
  definitionsCounts,
  versionsCounts,
  diagramOfVersion,
  statisticsPerVersion,
  statisticsDisjoint,
  statisticsCalledIncidents,
];
