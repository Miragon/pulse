export class MigrationPlanVocabulary {
  static readonly SCHEMA_VERSION = 1
  static readonly MAX_MAPPINGS = 1000
  static readonly MAX_PLAN_CHARACTERS = 1_048_576
  static readonly ROOT_KEYS: readonly string[] = [
    "$schema",
    "schemaVersion",
    "bpmnProcessId",
    "source",
    "target",
    "mappings",
  ]
  static readonly SIDE_KEYS: readonly string[] = ["version"]
  static readonly MAPPING_KEYS: readonly string[] = ["sourceElementId", "targetElementId"]
  static readonly ENGINE_PLAN_KEYS: readonly string[] = [
    "sourceProcessDefinitionId",
    "targetProcessDefinitionId",
    "instructions",
    "migrationPlan",
  ]
  static readonly FOREIGN_KEYS: readonly string[] = [
    "instanceIds",
    "processInstanceIds",
    "processInstanceQuery",
    "historicProcessInstanceQuery",
    "engine",
    "engineName",
    "url",
    "profile",
    "tenantId",
    "tenantIds",
    "definitionId",
    "sourceDefinitionId",
    "targetDefinitionId",
    "updateEventTrigger",
    "updateEventTriggers",
    "skipCustomListeners",
    "skipIoMappings",
    "variables",
  ]
}
