import { JsonView } from "@miragon/pulse-c7-core/runtime"
import { Present } from "../present.js"
import type { ActivityStatisticsView, DefinitionStatisticsView, DefinitionView } from "./views.js"

export class DefinitionViewParser {
  static definition(record: JsonView): DefinitionView {
    return {
      id: record.requiredString("id"),
      key: record.requiredString("key"),
      version: record.requiredNumber("version"),
      ...Present.fields({
        name: record.optionalString("name"),
        deploymentId: record.optionalString("deploymentId"),
        versionTag: record.optionalString("versionTag"),
      }),
    }
  }

  static definitionStatistics(value: unknown): DefinitionStatisticsView[] {
    return JsonView.listOf(value, "definition statistics").map((row) => ({
      definition: DefinitionViewParser.definition(
        row.object("definition", "statistics definition"),
      ),
      instances: row.requiredNumber("instances"),
    }))
  }

  static activityStatistics(value: unknown): ActivityStatisticsView[] {
    return JsonView.listOf(value, "activity statistics").map((row) => ({
      activityId: row.requiredString("id"),
      instances: row.requiredNumber("instances"),
    }))
  }

  static diagramXml(value: unknown): string {
    return JsonView.of(value, "definition XML").requiredString("bpmn20Xml")
  }
}
