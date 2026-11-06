import type { JsonObject } from "./json-object.js"
import { Present } from "./present.js"
import type {
  DefinitionView,
  ElementInstanceView,
  ElementStatisticsView,
  IncidentView,
  InstanceView,
  JobView,
  MessageSubscriptionView,
  ProcessStatisticsView,
  TopologyView,
  UserTaskView,
  VariableView,
  VersionStatisticsView,
} from "./views.js"

export class CamundaViews {
  static topology(json: JsonObject): TopologyView {
    return { gatewayVersion: json.requiredString("gatewayVersion") }
  }

  static definition(json: JsonObject): DefinitionView {
    return {
      key: json.requiredString("processDefinitionKey"),
      bpmnProcessId: json.requiredString("processDefinitionId"),
      version: json.requiredNumber("version"),
      ...Present.fields({
        name: json.optionalString("name"),
        versionTag: json.optionalString("versionTag"),
        state: json.optionalString("state"),
      }),
    }
  }

  static processStatistics(json: JsonObject): ProcessStatisticsView {
    return {
      bpmnProcessId: json.requiredString("processDefinitionId"),
      withoutIncident: json.requiredNumber("activeInstancesWithoutIncidentCount"),
      withIncident: json.requiredNumber("activeInstancesWithIncidentCount"),
    }
  }

  static versionStatistics(json: JsonObject): VersionStatisticsView {
    return {
      key: json.requiredString("processDefinitionKey"),
      withoutIncident: json.requiredNumber("activeInstancesWithoutIncidentCount"),
      withIncident: json.requiredNumber("activeInstancesWithIncidentCount"),
    }
  }

  static elementStatistics(json: JsonObject): ElementStatisticsView {
    return {
      elementId: json.requiredString("elementId"),
      active: json.requiredNumber("active"),
      incidents: json.requiredNumber("incidents"),
    }
  }

  static instance(json: JsonObject): InstanceView {
    return {
      key: json.requiredString("processInstanceKey"),
      definitionKey: json.requiredString("processDefinitionKey"),
      bpmnProcessId: json.requiredString("processDefinitionId"),
      version: json.requiredNumber("processDefinitionVersion"),
      state: json.requiredString("state"),
      hasIncident: json.flag("hasIncident"),
      ...Present.fields({
        definitionName: json.optionalString("processDefinitionName"),
        startedAt: json.optionalString("startDate"),
        endedAt: json.optionalString("endDate"),
        parentKey: json.optionalString("parentProcessInstanceKey"),
        parentElementKey: json.optionalString("parentElementInstanceKey"),
        businessId: json.optionalString("businessId"),
      }),
    }
  }

  static elementInstance(json: JsonObject): ElementInstanceView {
    return {
      key: json.requiredString("elementInstanceKey"),
      elementId: json.requiredString("elementId"),
      type: json.requiredString("type"),
      state: json.requiredString("state"),
      startedAt: json.requiredString("startDate"),
      ...Present.fields({
        name: json.optionalString("elementName"),
        endedAt: json.optionalString("endDate"),
        incidentKey: json.optionalString("incidentKey"),
      }),
    }
  }

  static job(json: JsonObject): JobView {
    return {
      key: json.requiredString("jobKey"),
      type: json.requiredString("type"),
      state: json.requiredString("state"),
      ...Present.fields({
        kind: json.optionalString("kind"),
        elementInstanceKey: json.optionalString("elementInstanceKey"),
        retries: json.optionalNumber("retries"),
      }),
    }
  }

  static userTask(json: JsonObject): UserTaskView {
    return {
      elementInstanceKey: json.requiredString("elementInstanceKey"),
      ...Present.fields({
        assignee: json.optionalString("assignee"),
        dueDate: json.optionalString("dueDate"),
      }),
    }
  }

  static messageSubscription(json: JsonObject): MessageSubscriptionView {
    return {
      elementInstanceKey: json.requiredString("elementInstanceKey"),
      ...Present.fields({
        messageName: json.optionalString("messageName"),
        correlationKey: json.optionalString("correlationKey"),
      }),
    }
  }

  static incident(json: JsonObject): IncidentView {
    return {
      key: json.requiredString("incidentKey"),
      instanceKey: json.requiredString("processInstanceKey"),
      definitionKey: json.requiredString("processDefinitionKey"),
      elementId: json.requiredString("elementId"),
      type: json.requiredString("errorType"),
      message: json.optionalString("errorMessage") ?? "",
      createdAt: json.requiredString("creationTime"),
      ...Present.fields({
        elementInstanceKey: json.optionalString("elementInstanceKey"),
        jobKey: json.optionalString("jobKey"),
      }),
    }
  }

  static variable(json: JsonObject): VariableView {
    return {
      name: json.requiredString("name"),
      value: json.requiredString("value"),
      truncated: json.flag("isTruncated"),
      scopeKey: json.requiredString("scopeKey"),
      instanceKey: json.requiredString("processInstanceKey"),
    }
  }
}
