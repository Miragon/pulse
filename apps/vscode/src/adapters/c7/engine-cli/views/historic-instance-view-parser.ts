import { Present } from '../present.js';
import { JsonObject } from './json-object.js';
import type { HistoricInstanceView } from './views.js';

export class HistoricInstanceViewParser {
  static instances(value: unknown): HistoricInstanceView[] {
    return JsonObject.listOf(value, 'historic process instances').map((record) =>
      HistoricInstanceViewParser.instanceOf(record),
    );
  }

  static count(value: unknown): number {
    return JsonObject.of(value, 'historic process instance count').requiredNumber('count');
  }

  private static instanceOf(record: JsonObject): HistoricInstanceView {
    return {
      id: record.requiredString('id'),
      processDefinitionId: record.requiredString('processDefinitionId'),
      processDefinitionKey: record.requiredString('processDefinitionKey'),
      processDefinitionVersion: record.requiredNumber('processDefinitionVersion'),
      state: record.requiredString('state'),
      ...Present.fields({
        businessKey: record.optionalString('businessKey'),
        processDefinitionName: record.optionalString('processDefinitionName'),
        startTime: record.optionalString('startTime'),
        endTime: record.optionalString('endTime'),
        superProcessInstanceId: record.optionalString('superProcessInstanceId'),
      }),
    };
  }
}
