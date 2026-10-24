import { Present } from '../present.js';
import { JsonObject } from './json-object.js';
import type { IncidentInstanceView, IncidentView } from './views.js';

export class IncidentViewParser {
  static incident(value: unknown): IncidentView {
    return IncidentViewParser.incidentOf(JsonObject.of(value, 'incident'));
  }

  static incidents(value: unknown): IncidentView[] {
    return JsonObject.listOf(value, 'incidents').map((record) =>
      IncidentViewParser.incidentOf(record),
    );
  }

  static incidentInstances(value: unknown): IncidentInstanceView[] {
    return JsonObject.listOf(value, 'incidents').map((record) =>
      Present.fields({
        processDefinitionId: record.optionalString('processDefinitionId'),
        processInstanceId: record.optionalString('processInstanceId'),
      }),
    );
  }

  private static incidentOf(record: JsonObject): IncidentView {
    return {
      id: record.requiredString('id'),
      incidentType: record.requiredString('incidentType'),
      activityId: record.requiredString('activityId'),
      incidentTimestamp: record.requiredString('incidentTimestamp'),
      ...Present.fields({
        processInstanceId: record.optionalString('processInstanceId'),
        processDefinitionId: record.optionalString('processDefinitionId'),
        incidentMessage: record.optionalString('incidentMessage'),
        rootCauseIncidentId: record.optionalString('rootCauseIncidentId'),
        configuration: record.optionalString('configuration'),
      }),
    };
  }
}
