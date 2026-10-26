import type { OfferedBulkKind } from "./bulk-views.js"
import type { StateMessage, WebviewIntent, WebviewIntentType } from "./messages.js"
import { MAX_VARIABLE_CONDITIONS, VariableConditionRules } from "./variable-condition-rules.js"
import type { VariableConditionView } from "./view-models.js"

type Fields = Readonly<Record<string, unknown>>

const MAX_NAME_LENGTH = 255
const MAX_VALUE_BYTES = 64 * 1024
const MAX_REASON_LENGTH = 500
const UTF8_LIMITS = [0x80, 0x800, 0x10000] as const
const SCOPES: ReadonlySet<unknown> = new Set(["running", "withIncident", "ended", "all"])
const PROCESS_SCOPES: ReadonlySet<unknown> = new Set(["all", "withIncident"])
const BULK_KINDS: Readonly<Record<OfferedBulkKind, true>> = { cancelInstances: true }
const MAX_SELECTED_IDS = 1000

export class MessageGuards {
  private static readonly INTENT_SHAPES: Readonly<
    Record<WebviewIntentType, (fields: Fields) => boolean>
  > = {
    ready: () => true,
    refresh: () => true,
    goBack: () => true,
    loadMoreInstances: () => true,
    copyHandover: () => true,
    openWebUi: () => true,
    editConnection: () => true,
    setCredentials: () => true,
    pauseLiveUpdates: () => true,
    resumeLiveUpdates: () => true,
    turnOnLiveUpdates: () => true,
    activity: () => true,
    selectMatching: () => true,
    clearSelection: () => true,
    stopBulk: () => true,
    dismissBulk: () => true,
    checkBulk: () => true,
    selectRemaining: () => true,
    showBulkFailures: () => true,
    openMigration: () => true,
    leaveOutUnmapped: () => true,
    startMigration: () => true,
    pickMigrationTarget: (fields) => MessageGuards.isName(fields.definitionId),
    mapElement: (fields) =>
      MessageGuards.isName(fields.sourceElementId) && MessageGuards.isName(fields.targetElementId),
    unmapElement: (fields) => MessageGuards.isName(fields.sourceElementId),
    focusMapping: (fields) => MessageGuards.isName(fields.sourceElementId),
    toggleInstances: (fields) =>
      MessageGuards.isIdList(fields.ids) && typeof fields.selected === "boolean",
    startBulk: (fields) =>
      typeof fields.action === "string" && Object.hasOwn(BULK_KINDS, fields.action),
    holdLiveUpdates: (fields) => typeof fields.held === "boolean",
    selectVersion: (fields) => MessageGuards.isText(fields.definitionId),
    filterInstances: (fields) => MessageGuards.isFilter(fields.filter),
    filterProcesses: (fields) => MessageGuards.isProcessFilter(fields.filter),
    openProcess: (fields) =>
      MessageGuards.isText(fields.bpmnProcessId) && typeof fields.toSide === "boolean",
    openInstance: (fields) =>
      MessageGuards.isText(fields.instanceId) && typeof fields.toSide === "boolean",
    openCall: (fields) =>
      MessageGuards.isText(fields.elementId) && typeof fields.toSide === "boolean",
    openDefinition: (fields) =>
      MessageGuards.isText(fields.bpmnProcessId) && MessageGuards.isText(fields.definitionId),
    openIncidentDetails: (fields) => MessageGuards.isText(fields.incidentId),
    selectElement: (fields) => MessageGuards.isText(fields.elementId),
    openModel: (fields) => MessageGuards.isSourceTarget(fields),
    openCode: (fields) => MessageGuards.isSourceTarget(fields),
    copy: (fields) => MessageGuards.isText(fields.text) && MessageGuards.isText(fields.label),
    retryIncident: (fields) => MessageGuards.isText(fields.incidentId),
    setVariable: (fields) =>
      MessageGuards.isName(fields.name) && MessageGuards.isValue(fields.valueJson),
    moveToken: (fields) =>
      MessageGuards.isName(fields.fromElementId) &&
      MessageGuards.isName(fields.toElementId) &&
      MessageGuards.isText(fields.reason) &&
      fields.reason.length <= MAX_REASON_LENGTH,
  }

  static isWebviewIntent(value: unknown): value is WebviewIntent {
    if (
      !MessageGuards.hasStringType(value) ||
      !Object.hasOwn(MessageGuards.INTENT_SHAPES, value.type)
    ) {
      return false
    }
    return MessageGuards.INTENT_SHAPES[value.type as WebviewIntentType](value)
  }

  static isStateMessage(value: unknown): value is StateMessage {
    return MessageGuards.hasStringType(value) && value.type === "state"
  }

  private static hasStringType(value: unknown): value is { readonly type: string } & Fields {
    return (
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      typeof (value as { readonly type: unknown }).type === "string"
    )
  }

  private static isText(value: unknown): value is string {
    return typeof value === "string"
  }

  private static isSourceTarget(fields: Fields): boolean {
    return [fields.incidentId, fields.elementId].every(
      (id) => id === undefined || MessageGuards.isText(id),
    )
  }

  private static isIdList(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.length <= MAX_SELECTED_IDS &&
      value.every((id) => MessageGuards.isText(id))
    )
  }

  private static isName(value: unknown): boolean {
    return MessageGuards.isText(value) && value.length > 0 && value.length <= MAX_NAME_LENGTH
  }

  private static isValue(value: unknown): boolean {
    return MessageGuards.isText(value) && MessageGuards.utf8Length(value) <= MAX_VALUE_BYTES
  }

  private static isFilter(value: unknown): boolean {
    if (typeof value !== "object" || value === null) {
      return false
    }
    const filter = value as Fields
    return (
      SCOPES.has(filter.scope) &&
      (filter.elementId === undefined || MessageGuards.isText(filter.elementId)) &&
      (filter.businessKey === undefined || MessageGuards.isText(filter.businessKey)) &&
      (filter.variables === undefined || MessageGuards.isConditionList(filter.variables))
    )
  }

  private static isConditionList(value: unknown): boolean {
    return (
      Array.isArray(value) &&
      value.length <= MAX_VARIABLE_CONDITIONS &&
      value.every((condition) => MessageGuards.isCondition(condition))
    )
  }

  private static isCondition(value: unknown): boolean {
    if (typeof value !== "object" || value === null) {
      return false
    }
    const condition = value as Fields
    return (
      MessageGuards.isName(condition.name) &&
      VariableConditionRules.isOperator(condition.operator) &&
      MessageGuards.isValue(condition.value) &&
      (condition.as === undefined || VariableConditionRules.isValueType(condition.as)) &&
      VariableConditionRules.fits(condition as unknown as VariableConditionView)
    )
  }

  private static isProcessFilter(value: unknown): boolean {
    if (typeof value !== "object" || value === null) {
      return false
    }
    const filter = value as Fields
    return (
      PROCESS_SCOPES.has(filter.scope) &&
      (filter.search === undefined || MessageGuards.isText(filter.search))
    )
  }

  private static utf8Length(text: string): number {
    let bytes = 0
    for (const character of text) {
      const code = character.codePointAt(0) ?? 0
      bytes += 1 + UTF8_LIMITS.filter((limit) => code >= limit).length
    }
    return bytes
  }
}
