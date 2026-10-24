import {
  InstanceId,
  type DefinitionRef,
  type InstanceSummary,
} from '../../../contract/index.js';
import { Present, type HistoricInstanceView } from '../engine-cli/index.js';
import { InstanceStates } from './instance-states.js';
import type { Mapper } from './mapper.js';
import { Timestamps } from './timestamps.js';

export interface HistoricFacts {
  readonly row: HistoricInstanceView;
  readonly hasIncident: boolean;
}

export class HistoricSummaryMapper implements Mapper<HistoricFacts, InstanceSummary> {
  constructor(private readonly definitions: Mapper<HistoricInstanceView, DefinitionRef>) {}

  map({ row, hasIncident }: HistoricFacts): InstanceSummary {
    return {
      id: InstanceId(row.id),
      definition: this.definitions.map(row),
      state: InstanceStates.of(row.state),
      hasIncident,
      ...Present.fields({
        businessKey: row.businessKey,
        startedAt: Timestamps.optional(row.startTime),
        endedAt: Timestamps.optional(row.endTime),
        parentInstanceId:
          row.superProcessInstanceId === undefined
            ? undefined
            : InstanceId(row.superProcessInstanceId),
      }),
    };
  }
}
