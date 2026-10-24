import {
  InstanceId,
  type DefinitionRef,
  type InstanceSummary,
} from '../../../contract/index.js';
import { Present, type DefinitionView, type InspectView } from '../engine-cli/index.js';
import { InstanceStates } from './instance-states.js';
import type { Mapper } from './mapper.js';
import { Timestamps } from './timestamps.js';

export class InstanceSummaryMapper implements Mapper<InspectView, InstanceSummary> {
  constructor(private readonly definitions: Mapper<DefinitionView, DefinitionRef>) {}

  map(view: InspectView): InstanceSummary {
    return {
      id: InstanceId(view.id),
      definition: this.definitions.map(view.definition),
      state: InstanceStates.of(view.state),
      hasIncident: view.incidents.length > 0 || view.propagatedIncidents > 0,
      ...Present.fields({
        businessKey: view.businessKey,
        startedAt: Timestamps.optional(view.startTime),
        endedAt: Timestamps.optional(view.endTime),
        parentInstanceId: view.parentId === undefined ? undefined : InstanceId(view.parentId),
      }),
    };
  }
}
