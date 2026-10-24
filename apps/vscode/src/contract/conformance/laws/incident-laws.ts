import { BpmnProcessId, ElementId, type DefinitionId } from '../../model/ids.js';
import type { Incident } from '../../model/read-models.js';
import { Ensure } from '../ensure.js';
import { CASE, type ConformanceCase } from '../conformance-case.js';
import { WORLD_ELEMENT, WORLD_PROCESS } from '../world/world.js';

const PAGE = { limit: 50 } as const;

const incidentsRootOnly: ConformanceCase = {
  name: CASE.incidentsRootOnly,
  async run(harness) {
    const page = await harness.runtime.searchIncidents({}, PAGE);
    Ensure.sameSet(
      page.items.map((incident) => incident.elementId),
      [ElementId(WORLD_ELEMENT.chargePayment), ElementId(WORLD_ELEMENT.renderLabel)],
      this.name,
    );
  },
};

const incidentsFiltered: ConformanceCase = {
  name: CASE.incidentsFiltered,
  async run(harness) {
    const byProcess = await harness.runtime.searchIncidents(
      { bpmnProcessId: BpmnProcessId(WORLD_PROCESS.order) },
      PAGE,
    );
    Ensure.sameSet(
      byProcess.items.map((incident) => incident.elementId),
      [ElementId(WORLD_ELEMENT.chargePayment)],
      this.name,
    );
    const byInstance = await harness.runtime.searchIncidents(
      { instanceId: harness.world.instanceIds['ORD-1002'] },
      PAGE,
    );
    Ensure.that(
      byInstance.items.length === 1,
      this.name,
      `by instance: ${byInstance.items.length}`,
    );
  },
};

interface ExpectedVersion {
  readonly definitionId: DefinitionId;
  readonly bpmnProcessId: string;
  readonly version: number;
}

class IncidentChecks {
  static ensureNamesVersion(
    incident: Incident | undefined,
    expected: ExpectedVersion,
    law: string,
  ): void {
    const definition = Ensure.defined(
      incident,
      law,
      `no incident of ${expected.bpmnProcessId}`,
    ).definition;
    Ensure.that(
      definition.id === expected.definitionId &&
        definition.bpmnProcessId === BpmnProcessId(expected.bpmnProcessId) &&
        definition.version === expected.version,
      law,
      `expected ${Ensure.describe(expected)}, got ${Ensure.describe(definition)}`,
    );
  }
}

const incidentsNameTheirVersion: ConformanceCase = {
  name: CASE.incidentsNameTheirVersion,
  async run(harness) {
    const { definitionIds, instanceIds } = harness.world;
    const order = {
      definitionId: definitionIds['order@1'],
      bpmnProcessId: WORLD_PROCESS.order,
      version: 1,
    };
    const label = {
      definitionId: definitionIds['label@1'],
      bpmnProcessId: WORLD_PROCESS.label,
      version: 1,
    };
    const listed = (await harness.runtime.searchIncidents({}, PAGE)).items;
    const at = (elementId: string) =>
      listed.find((incident) => incident.elementId === ElementId(elementId));
    IncidentChecks.ensureNamesVersion(at(WORLD_ELEMENT.chargePayment), order, this.name);
    IncidentChecks.ensureNamesVersion(at(WORLD_ELEMENT.renderLabel), label, this.name);
    const failed = await harness.runtime.getInstanceDetail(instanceIds['ORD-1002']);
    IncidentChecks.ensureNamesVersion(failed?.incidents[0], order, this.name);
    const caller = await harness.runtime.getInstanceDetail(instanceIds['DSP-3001']);
    IncidentChecks.ensureNamesVersion(caller?.incidents[0], label, this.name);
  },
};

const incidentDetailsComplete: ConformanceCase = {
  name: CASE.incidentDetailsComplete,
  async run(harness) {
    const page = await harness.runtime.searchIncidents(
      { instanceId: harness.world.instanceIds['ORD-1002'] },
      PAGE,
    );
    const incident = Ensure.defined(page.items[0], this.name, 'no incident of ORD-1002');
    const details = Ensure.defined(
      await harness.runtime.getIncidentDetails(incident.id),
      this.name,
      'no details for the failed task',
    );
    Ensure.that(details.text.trim() !== '', this.name, 'the details are blank');
    Ensure.that(!details.truncated, this.name, 'full details must never be truncated');
    const unknown = await harness.runtime.getIncidentDetails(harness.world.unknown.incidentId);
    Ensure.that(unknown === undefined, this.name, 'an unknown incident must be undefined');
  },
};

export const INCIDENT_LAWS: readonly ConformanceCase[] = [
  incidentsRootOnly,
  incidentsFiltered,
  incidentsNameTheirVersion,
  incidentDetailsComplete,
];
