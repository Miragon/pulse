import {
  ElementId,
  IncidentId,
  InstanceId,
  type DefinitionRef,
  type Incident,
  type IncidentJob,
} from '../../../contract/index.js';
import { Present, type IncidentView } from '../engine-cli/index.js';
import type { Mapper } from './mapper.js';
import { Timestamps } from './timestamps.js';

const WORK_INCIDENT_TYPES: ReadonlySet<string> = new Set(['failedJob', 'failedExternalTask']);

export interface IncidentRowFacts {
  readonly row: IncidentView;
  readonly definitionsById: ReadonlyMap<string, DefinitionRef>;
}

export class IncidentRowMapper implements Mapper<IncidentRowFacts, Incident | undefined> {
  map({ row, definitionsById }: IncidentRowFacts): Incident | undefined {
    const definition = definitionsById.get(row.processDefinitionId ?? '');
    if (row.processInstanceId === undefined || definition === undefined) {
      return undefined;
    }
    return {
      id: IncidentId(row.id),
      instanceId: InstanceId(row.processInstanceId),
      definition,
      elementId: ElementId(row.activityId),
      type: row.incidentType,
      message: row.incidentMessage ?? '',
      createdAt: Timestamps.fromEngine(row.incidentTimestamp),
      ...Present.fields({ job: this.jobOf(row) }),
    };
  }

  private jobOf(row: IncidentView): IncidentJob | undefined {
    return row.configuration !== undefined && WORK_INCIDENT_TYPES.has(row.incidentType)
      ? { id: row.configuration }
      : undefined;
  }
}
